"""Pack raw glbs with gltf-transform (meshopt) and write the city manifest.

    uv run python assets/blender/pack.py [--only <id> ...] [--out <dir>]

For each raw glb in assets/blender/out/raw it runs
`pnpm exec gltf-transform meshopt <raw> <out>/<file> --level medium`. Without flags it packs
every built asset in specs.ASSETS into apps/web/public/city/ and writes manifest.json there
(only the assets that were built). With --only or --out the manifest is not written. Test
assets (calib) are packed only through --only.
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
from tl_assets.specs import ASSETS, get_spec  # noqa: E402

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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--only", action="append", default=[], help="asset id (repeatable)")
    ap.add_argument("--out", type=Path, help=f"output folder (default {CITY})")
    args = ap.parse_args(argv)
    out = args.out or CITY
    if args.only:
        ids = args.only
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
