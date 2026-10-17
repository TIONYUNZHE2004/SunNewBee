"""Blender entry point: build one asset's glb (and optionally its owner-gate preview).

Run headless, one asset per process:

    blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
        --python assets/blender/tl_assets/build.py -- --asset calib --out assets/blender/out/raw \
        [--preview]

`BUILDERS` maps an asset id to `(variant, lod) -> [objects]`. Builder modules added by later
tasks (`tl_assets.archetypes`, `tl_assets.landmarks`, `tl_assets.props`) expose their own
`BUILDERS` dict, merged in when present.
"""

import argparse
import importlib
import importlib.util
import math
import random
import sys
from collections.abc import Callable
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[1]
if str(ASSETS_DIR) not in sys.path:
    sys.path.insert(0, str(ASSETS_DIR))

import bpy  # noqa: E402

from tl_assets import core  # noqa: E402
from tl_assets.specs import Variant, get_spec  # noqa: E402

PREVIEW_DIR = ASSETS_DIR / "out" / "preview"
BUILDER_MODULES = ("tl_assets.archetypes", "tl_assets.landmarks", "tl_assets.props")


# --- calibration asset ------------------------------------------------------------------


def _calib(variant: Variant, lod: int) -> list:
    """A 10 × 10 × 10 box with a 2 m porch slab (role secondary) on its +z (frontage) side."""
    w, h, d = 10.0, 10.0, 10.0
    cuts = (8, 2, 0)[lod]
    body = core.box("calib_body", w, h, d, cuts=cuts)
    core.set_role(body, "primary", aux=lambda i: (i % 7) / 7.0)
    slab = core.box("calib_porch", 6.0, 0.3, 2.0, z=d / 2 + 1.0, y=3.0, cuts=(4, 0, 0)[lod])
    core.set_role(slab, "secondary")
    return [body, slab]


BUILDERS: dict[str, Callable[[Variant, int], list]] = {"calib": _calib}


def _load_builders() -> None:
    for name in BUILDER_MODULES:
        if importlib.util.find_spec(name) is not None:
            BUILDERS.update(importlib.import_module(name).BUILDERS)


# --- build ------------------------------------------------------------------------------


def _build_objects(asset_id: str, bake: bool = True) -> list[tuple[Variant, int, object]]:
    """Every (variant, lod) of the asset as one joined, AO-baked object, checked against caps."""
    _load_builders()
    if asset_id not in BUILDERS:
        raise KeyError(f"no builder for asset {asset_id!r}")
    spec = get_spec(asset_id)
    core.reset_scene()
    random.seed(asset_id)
    out = []
    for v in spec.variants:
        for lod, cap in enumerate(v.tris):
            name = f"{asset_id}__{v.id}__LOD{lod}"
            obj = core.join(BUILDERS[asset_id](v, lod), name)
            tris = core.tri_count(obj)
            if tris > cap:
                raise ValueError(f"{name}: {tris} triangles over the cap {cap}")
            if bake:
                core.bake_ao(obj)
            print(f"[tl_assets] {name}: {tris} tris")
            out.append((v, lod, obj))
    return out


def build_asset(asset_id: str, out: Path) -> Path:
    """Build `asset_id` and export it to `out / spec.file`; returns the glb path."""
    path = Path(out) / get_spec(asset_id).file
    objs = [o for _, _, o in _build_objects(asset_id)]
    core.export_glb(objs, path)
    print(f"[tl_assets] wrote {path}")
    return path


def preview(asset_id: str) -> None:
    """Owner gate: all variants × LODs in a row, sun + sky, camera framed; renders a PNG."""
    built = _build_objects(asset_id)
    mat = core.preview_material()
    x = 0.0
    gap = 2.0
    lo_y, hi_y, max_h = math.inf, -math.inf, 0.0
    for v, _lod, obj in built:
        w, h, d = v.size
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        obj.location.x = x + w / 2
        x += w + gap
        max_h = max(max_h, h)
        lo_y, hi_y = min(lo_y, -d / 2), max(hi_y, d / 2)
    width = x - gap
    scene = bpy.context.scene
    core.sun_and_sky(scene)
    cam_data = bpy.data.cameras.new("tl_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(width, max_h * 3.0) * 1.1
    cam = bpy.data.objects.new("tl_cam", cam_data)
    scene.collection.objects.link(cam)
    dist = max(width, max_h) * 2.0
    cam_data.clip_end = max(cam_data.clip_end, dist * 4.0)  # big landmarks sit far from the camera
    cam.location = (width / 2, lo_y - dist * 0.8, max_h / 2 + dist * 0.45)  # frontage side
    target = bpy.data.objects.new("tl_target", None)
    target.location = (width / 2, 0.0, max_h / 2)
    scene.collection.objects.link(target)
    track = cam.constraints.new("TRACK_TO")
    track.target = target
    scene.camera = cam
    core.set_engine(scene, "CYCLES")
    scene.cycles.samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(PREVIEW_DIR / f"{asset_id}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[tl_assets] preview {scene.render.filepath}")


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="build.py")
    ap.add_argument("--asset", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--preview", action="store_true", help="also render out/preview/<id>.png")
    args = ap.parse_args(argv)
    build_asset(args.asset, args.out)
    if args.preview:
        preview(args.asset)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
