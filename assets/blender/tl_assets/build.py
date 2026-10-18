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
import json
import math
import random
import re
import sys
from collections.abc import Callable
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[1]
if str(ASSETS_DIR) not in sys.path:
    sys.path.insert(0, str(ASSETS_DIR))

import bpy  # noqa: E402
import mathutils  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402

from tl_assets import core, kit  # noqa: E402
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


_SUFFIX = re.compile(r"\.\d{3,}$")


def part_names(objs) -> list[str]:
    """The sorted, de-duplicated names of the parts before the join (Blender's `.001`
    suffixes dropped)."""
    return sorted({_SUFFIX.sub("", o.name) for o in objs})


def _build_objects(
    asset_id: str, bake: bool = True, parts: dict[str, list[str]] | None = None
) -> list[tuple[Variant, int, object]]:
    """Every (variant, lod) of the asset as one joined, AO-baked object, checked against caps.

    `parts`, when given, collects {node name: part names before the join} (the node-name check
    of the tests: the join keeps one node per LOD, so the parts are recorded beside the glb).
    """
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
            kit.reset_lit_balance()  # each node balances its own lit-window share
            built = BUILDERS[asset_id](v, lod)
            kit.finalize_seeds()  # no-op after a `kit.lit_node` builder
            if parts is not None:
                parts[name] = part_names(built)
            obj = core.join(built, name)
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
    parts: dict[str, list[str]] = {}
    objs = [o for _, _, o in _build_objects(asset_id, parts=parts)]
    core.export_glb(objs, path)
    parts_path(path).write_text(json.dumps(parts, indent=1) + "\n", encoding="utf-8")
    print(f"[tl_assets] wrote {path}")
    return path


def parts_path(glb: Path) -> Path:
    """The part-name sidecar of a raw glb: `<name>.parts.json` beside it (raw output only)."""
    return Path(glb).with_suffix(".parts.json")


def _bbox(objs) -> list:
    """The eight world-space corners of every object's bounding box, together."""
    bpy.context.view_layer.update()
    return [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]


def _frame_camera(scene, cam, corners, azimuth: float = 35.0, elevation: float = 30.0) -> None:
    """Perspective 3/4 view from the front-left (frontage is Blender -y, left is -x).

    Looks at the middle of `corners` and backs off until every corner is inside the frame.
    """
    lo = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
    hi = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
    centre = (lo + hi) / 2.0
    az, el = math.radians(azimuth), math.radians(elevation)
    direction = mathutils.Vector(
        (-math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))
    )
    cam.data.lens = 50.0
    cam.data.clip_start = 0.1
    cam.data.clip_end = 5000.0
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    margin = 0.04

    def fits(dist: float) -> bool:
        cam.location = centre + direction * dist
        bpy.context.view_layer.update()
        for c in corners:
            v = world_to_camera_view(scene, cam, c)
            if v.z <= 0 or not (margin <= v.x <= 1 - margin and margin <= v.y <= 1 - margin):
                return False
        return True

    near, far = 1.0, 4000.0
    for _ in range(40):
        mid = (near + far) / 2.0
        near, far = (near, mid) if fits(mid) else (mid, far)
    cam.location = centre + direction * far
    bpy.context.view_layer.update()


def _layout(items) -> None:
    """Place objects left to right along +x with a gap, each centred on its footprint."""
    x, gap = 0.0, 2.0
    for v, _lod, obj in items:
        w = v.size[0]
        obj.location.x = x + w / 2
        x += w + gap


def _render(scene, path: Path, size: tuple[int, int]) -> None:
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"[tl_assets] preview {path}")


def preview(asset_id: str) -> None:
    """Owner gate: renders `<id>.png` (all variants x LODs in a row) and `<id>_lod0.png`
    (LOD0 variants only, closer), both from a perspective 3/4 view on the front-left."""
    built = _build_objects(asset_id)
    mat = core.preview_material()
    for _v, _lod, obj in built:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    scene = bpy.context.scene
    core.sun_and_sky(scene)
    cam_data = bpy.data.cameras.new("tl_cam")
    cam = bpy.data.objects.new("tl_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    core.set_engine(scene, "CYCLES")
    scene.cycles.samples = 48
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    _layout(built)
    scene.render.resolution_x, scene.render.resolution_y = 2000, 900
    _frame_camera(scene, cam, _bbox([o for _, _, o in built]))
    _render(scene, PREVIEW_DIR / f"{asset_id}.png", (2000, 900))

    lod0 = [b for b in built if b[1] == 0]
    for _v, lod, obj in built:
        obj.hide_render = lod != 0
    _layout(lod0)
    scene.render.resolution_x, scene.render.resolution_y = 1800, 1200
    _frame_camera(scene, cam, _bbox([o for _, _, o in lod0]))
    scene.cycles.samples = 96
    _render(scene, PREVIEW_DIR / f"{asset_id}_lod0.png", (1800, 1200))


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
