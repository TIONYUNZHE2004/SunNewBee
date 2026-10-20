"""Pack raw glbs with gltf-transform (meshopt) and write the city manifest.

    uv run python assets/blender/pack.py [--only <id> ...] [--out <dir>]

For each raw glb in assets/blender/out/raw it runs
`pnpm exec gltf-transform meshopt <raw> <out>/<file> --level medium`. Without flags it packs
every built asset in specs.ASSETS into apps/web/public/city/ and writes manifest.json there
(only the assets that were built). With --only or --out the manifest is not written. Test
assets (calib) are packed only through --only.

`--heroes` instead packs the rigged hero glbs (out/raw/characters/hero_<variant>.glb, from
tl_assets/characters/export_hero.py) into apps/web/public/city/characters/ with the same
meshopt settings, and writes characters/manifest.json from their stats.

`--crowd` packs the crowd kit (out/raw/characters/crowd_<body>.glb, from
tl_assets/characters/export_crowd.py) the same way and writes characters/crowd.json (looks,
bodies, clips, palettes; C-T6).
"""

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from tl_assets.glbinfo import read_glb  # noqa: E402
from tl_assets.manifest import build_manifest  # noqa: E402
from tl_assets.specs import ASSETS, TEST_ASSETS, get_spec  # noqa: E402

RAW = HERE / "out" / "raw"
CITY = ROOT / "apps" / "web" / "public" / "city"
LANDMARKS = ROOT / "data" / "seed" / "elmina" / "base" / "landmarks.geojson"


def pack_one(raw: Path, dest: Path) -> None:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("pnpm not found on PATH")
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [pnpm, "exec", "gltf-transform", "meshopt", str(raw), str(dest), "--level", "medium"]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0 or not dest.exists():
        raise RuntimeError(f"gltf-transform failed on {raw}:\n{proc.stdout}\n{proc.stderr}")


def write_manifest(out: Path, packed: dict[str, Path]) -> Path:
    infos = {a: read_glb(p) for a, p in packed.items()}
    fc = json.loads(LANDMARKS.read_text(encoding="utf-8")) if LANDMARKS.exists() else {}
    manifest = build_manifest(infos, dt.date.today().isoformat(), fc)
    path = out / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def pack_heroes(out: Path) -> int:
    from tl_assets.characters import manifest as hero_manifest
    from tl_assets.characters import rig

    raw = RAW / "characters"
    stats, sizes = {}, {}
    for v in rig.VARIANTS:
        src = raw / f"hero_{v}.glb"
        if not src.exists():
            print(f"no raw glb for hero {v}; run export_hero.py", file=sys.stderr)
            return 1
        dest = out / "characters" / src.name
        pack_one(src, dest)
        stats[v] = json.loads((raw / f"hero_{v}.json").read_text(encoding="utf-8"))
        nodes = read_glb(dest).nodes  # triangles as shipped (the exporter may re-triangulate)
        for lod in stats[v]["lods"]:
            n = lod["node"].rsplit("__", 1)[1]
            lod["tris"] = sum(i.tris for name, i in nodes.items() if name.endswith(f"__{n}"))
        sizes[v] = dest.stat().st_size
        print(f"packed hero {v}: {sizes[v]} bytes -> {dest}")
    m = hero_manifest.build(stats, sizes)  # no date: a repack is byte-stable
    path = out / "characters" / "manifest.json"
    path.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path}")
    return 0


def pack_crowd(out: Path) -> int:
    from tl_assets.characters import crowd, crowd_looks

    raw = RAW / "characters"
    stats, sizes = {}, {}
    for b in crowd.BODIES:
        src = raw / f"crowd_{b}.glb"
        if not src.exists():
            print(f"no raw glb for crowd body {b}; run export_crowd.py", file=sys.stderr)
            return 1
        dest = out / "characters" / src.name
        pack_one(src, dest)
        stats[b] = json.loads((raw / f"crowd_{b}.json").read_text(encoding="utf-8"))
        nodes = read_glb(dest).nodes  # triangles as shipped
        stats[b]["meshes"] = {n: i.tris for n, i in nodes.items() if "__LOD" in n}
        sizes[b] = dest.stat().st_size
        print(f"packed crowd {b}: {sizes[b]} bytes -> {dest}")
    m = crowd_looks.build_manifest(stats, sizes)
    if (raw / "crowd_worker.glb").exists():  # keep the devsim worker across a crowd repack
        m["worker"] = pack_worker(out)
    path = out / "characters" / "crowd.json"
    path.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path} ({len(m['looks'])} looks, {sum(sizes.values())} bytes)")
    return 0


def pack_worker(out: Path) -> dict:
    """Pack crowd_worker.glb (AS1) and return its manifest entry (`crowd.json` key `worker`)."""
    from tl_assets.characters import crowd_looks

    raw = RAW / "characters"
    dest = out / "characters" / "crowd_worker.glb"
    pack_one(raw / "crowd_worker.glb", dest)
    stats = json.loads((raw / "crowd_worker.json").read_text(encoding="utf-8"))
    stats["meshes"] = {n: i.tris for n, i in read_glb(dest).nodes.items() if "__LOD" in n}
    print(f"packed worker: {dest.stat().st_size} bytes -> {dest}")
    return crowd_looks.worker_entry(stats, dest.stat().st_size)


def pack_worker_only(out: Path) -> int:
    path = out / "characters" / "crowd.json"
    m = json.loads(path.read_text(encoding="utf-8"))
    m["worker"] = pack_worker(out)
    path.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path} (worker entry)")
    return 0


def _drop_pnpm_separator(argv: list[str]) -> list[str]:
    """`pnpm assets:build -- --all` hands the script a literal leading `--`; argparse would
    treat everything after it as positional, so drop it."""
    return argv[1:] if argv[:1] == ["--"] else argv


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--only", action="append", default=[], help="asset id (repeatable)")
    ap.add_argument("--out", type=Path, help=f"output folder (default {CITY})")
    ap.add_argument("--heroes", action="store_true", help="pack the rigged hero glbs only")
    ap.add_argument("--crowd", action="store_true", help="pack the crowd kit glbs only")
    ap.add_argument("--worker", action="store_true", help="pack crowd_worker.glb + crowd.json key")
    args = ap.parse_args(_drop_pnpm_separator(sys.argv[1:] if argv is None else argv))
    out = args.out or CITY
    if args.heroes:
        return pack_heroes(out)
    if args.crowd:
        return pack_crowd(out)
    if args.worker:
        return pack_worker_only(out)
    if args.only:
        ids = args.only
        tests = [a for a in ids if a in TEST_ASSETS]
        if tests and args.out is None:
            print(
                f"test assets {tests} never pack into {CITY}; give --out <dir>",
                file=sys.stderr,
            )
            return 2
        for asset_id in ids:
            if not (RAW / get_spec(asset_id).file).exists():
                print(f"no raw glb for {asset_id}; run run.py --asset {asset_id}", file=sys.stderr)
                return 1
    else:
        ids = [a for a, s in ASSETS.items() if (RAW / s.file).exists()]
    packed: dict[str, Path] = {}
    for asset_id in ids:
        spec = get_spec(asset_id)
        dest = out / spec.file
        pack_one(RAW / spec.file, dest)
        packed[asset_id] = dest
        print(f"packed {asset_id}: {dest.stat().st_size} bytes -> {dest}")
    if not args.only and args.out is None:
        print(f"wrote {write_manifest(out, packed)} ({len(packed)} assets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
