"""The journey hero (C-T2): a chibi older woman in a purple baju kurung and a lilac tudung,
with a scripted walker. Runs only inside Blender 5.2 (imports bpy); the geometry itself is pure
and lives in `parts.py`.

`build_hero(pose)` returns `(body, walker)`:
- `body`: one mesh, separate closed shells per part, `COLOR_0` (corner, linear RGBA) holds the
  clay colour, vertex groups name the rig regions for C-T3 (`head`, `face`, `tudung_cape`,
  `torso`, `kain` plus soft `kain_L`/`kain_R`, `arm_L/R`, `hand_L/R`, `shoe_L/R`), one material
  `hero_body`.
- `walker`: one mesh, `COLOR_0`, material `hero_walker`; `None` for the T-pose.
`pose` is `"tpose"` (upright, arms level: the bind pose) or `"walker"` (stooped, hands on
the grips).
"""

import bpy
import numpy as np

from . import parts as H
from . import proportions as P


def _lin(role: str) -> tuple[float, float, float, float]:
    """A palette role (or a literal "#rrggbb") as linear RGBA."""
    r, g, b = (
        P.srgb_to_linear(c) for c in P.hex_rgb(role if role.startswith("#") else P.PALETTE[role])
    )
    return (r, g, b, 1.0)


# --- bpy ---------------------------------------------------------------------------------


def clay_material(name: str, roughness: float = 0.62, metallic: float = 0.0, sheen: float = 0.25):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "COLOR_0"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.08
    return mat


def make_object(name: str, parts, material) -> bpy.types.Object:
    verts: list = []
    faces: list = []
    face_roles: list[str | None] = []
    face_grad: dict[int, H.Gradient] = {}
    groups: dict[str, list[int]] = {}
    for group, role, (pv, pf) in parts:
        base = len(verts)
        verts += pv
        faces += [tuple(i + base for i in f) for f in pf]
        for f in pf:
            c = tuple(sum(pv[i][j] for i in f) / len(f) for j in range(3))
            if isinstance(role, H.Gradient):
                face_grad[len(face_roles)] = role
            face_roles.append(H.role_of(role, c))
        groups.setdefault(group, []).extend(range(base, base + len(pv)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(clean_customdata=False)
    me.update()
    attr = me.color_attributes.new("COLOR_0", "FLOAT_COLOR", "CORNER")
    cols = np.zeros((len(me.loops), 4), dtype=np.float32)
    lut = {r: _lin(r) for r in set(face_roles) if r is not None}
    for poly in me.polygons:
        grad = face_grad.get(poly.index)
        if grad is None:
            cols[poly.loop_start : poly.loop_start + poly.loop_total] = lut[face_roles[poly.index]]
            continue
        for li, vi in zip(poly.loop_indices, poly.vertices, strict=True):
            r, g, b = (P.srgb_to_linear(c) for c in grad(verts[vi]))
            cols[li] = (r, g, b, 1.0)
    attr.data.foreach_set("color", cols.ravel())
    me.shade_smooth()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for g, ids in groups.items():
        obj.vertex_groups.new(name=g).add(ids, 1.0, "REPLACE")
    if "kain" in groups:  # soft left/right skirt regions for the thigh/shin bones (C-T3)
        left, right = obj.vertex_groups.new(name="kain_L"), obj.vertex_groups.new(name="kain_R")
        for i in groups["kain"]:
            w = H.smoothstep(-0.08, 0.08, verts[i][0])
            if w > 0:
                left.add([i], w, "REPLACE")
            if w < 1:
                right.add([i], 1 - w, "REPLACE")
    return obj


def build_hero(pose: str = "walker", suffix: str = ""):
    body_mat = bpy.data.materials.get("hero_body") or clay_material("hero_body")
    walker_mat = bpy.data.materials.get("hero_walker") or clay_material(
        "hero_walker", 0.4, 0.35, 0.0
    )
    body = make_object(f"hero_{pose}{suffix}", H.hero_parts(pose), body_mat)
    walker = (
        make_object(f"walker{suffix}", H.walker_parts(), walker_mat) if pose == "walker" else None
    )
    return body, walker
