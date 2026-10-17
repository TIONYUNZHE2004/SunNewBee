"""Blender helpers for the asset builders (imports bpy; runs only inside Blender 5.2).

Frame: builders work in glTF terms through `box`/`to_blender`: x = width (east), y = up,
z = towards the frontage. Blender itself is z-up, and the exporter (export_yup) maps Blender
(x, y, z) to glTF (x, z, -y), so glTF +z is Blender -y.

Vertex contract (`COLOR_0`, corner domain, RGBA): R = baked AO, G = role index / 7,
B = per-class aux, A = 1. One material, `tl_role`, per asset.
"""

from collections.abc import Callable
from pathlib import Path

import bmesh
import bpy

from .specs import ROLES

COLOR_ATTR = "COLOR_0"
AO_TMP_ATTR = "tl_ao_tmp"
MATERIAL = "tl_role"
GROUND_SIZE_M = 40.0


# --- scene ----------------------------------------------------------------------------


def reset_scene() -> None:
    """Empty the scene and purge every mesh, material, camera, light and world."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)
    for world in list(bpy.data.worlds):
        bpy.data.worlds.remove(world)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("tl_world")
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    bpy.context.view_layer.update()


def set_engine(scene, engine: str) -> None:
    """Switch render engine (a dynamic enum: assign and report the accepted ids on failure)."""
    try:
        scene.render.engine = engine
    except TypeError as e:
        raise RuntimeError(f"render engine {engine!r} not available: {e}") from e


def to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    """A glTF-frame point (x, y up, z frontage) in Blender coordinates."""
    return (x, -z, y)


def _link(obj) -> None:
    bpy.context.scene.collection.objects.link(obj)


def box(
    name: str,
    w: float,
    h: float,
    d: float,
    x: float = 0.0,
    y: float = 0.0,
    z: float = 0.0,
    cuts: int = 0,
):
    """A w × h × d box (glTF x, y, z extents) whose bottom centre is at glTF (x, y, z).

    `cuts` subdivides every edge (a grid on every face), which gives the AO bake vertices to
    vary across.
    """
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts > 0:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bx, by, bz = to_blender(x, y, z)
    for v in bm.verts:
        v.co.x = bx + v.co.x * w
        v.co.y = by + v.co.y * d
        v.co.z = bz + (v.co.z + 0.5) * h
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    _link(obj)
    return obj


def _ground(name: str, size: float):
    """A single-sided size × size plane at y = 0, facing up."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    _link(obj)
    return obj


# --- vertex contract ------------------------------------------------------------------


def _color_attr(mesh, name: str):
    attr = mesh.color_attributes.get(name)
    if attr is None or attr.domain != "CORNER" or attr.data_type != "FLOAT_COLOR":
        if attr is not None:
            mesh.color_attributes.remove(attr)
        attr = mesh.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
    return attr


def _make_active(mesh, name: str) -> None:
    attrs = mesh.color_attributes
    idx = next(i for i, a in enumerate(attrs) if a.name == name)
    attrs.active_color_index = idx
    attrs.render_color_index = idx


def set_role(obj, role: str, aux: float | Callable[[int], float] = 0.0) -> None:
    """Write COLOR_0 on every corner: R = 1 (AO comes later), G = role / 7, B = aux, A = 1.

    `aux` may be a callable of the polygon index (for example a per-window seed).
    """
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {ROLES}")
    mesh = obj.data
    attr = _color_attr(mesh, COLOR_ATTR)
    g = ROLES.index(role) / 7.0
    n = len(mesh.loops)
    values = [0.0] * (n * 4)
    if callable(aux):
        for poly in mesh.polygons:
            b = float(aux(poly.index))
            for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
                values[li * 4 : li * 4 + 4] = (1.0, g, b, 1.0)
    else:
        values = [1.0, g, float(aux), 1.0] * n
    attr.data.foreach_set("color", values)
    _make_active(mesh, COLOR_ATTR)


def role_material():
    """The single export material `tl_role` (a plain Principled BSDF)."""
    mat = bpy.data.materials.get(MATERIAL)
    if mat is None:
        mat = bpy.data.materials.new(MATERIAL)
        mat.use_nodes = True
        mat.use_backface_culling = True  # exports doubleSided: false
    return mat


def _select_only(objs, active=None) -> None:
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def join(objs: list, name: str):
    """Apply modifiers and transforms, join into one object `name` with one material."""
    if not objs:
        raise ValueError(f"{name}: nothing to join")
    for o in objs:
        if o.type != "MESH":
            raise ValueError(f"{name}: {o.name} is not a mesh")
        if o.data.color_attributes.get(COLOR_ATTR) is None:
            set_role(o, "primary")
    _select_only(objs)
    if any(o.modifiers for o in objs):
        bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    _make_active(obj.data, COLOR_ATTR)
    obj.data.materials.clear()
    obj.data.materials.append(role_material())
    for poly in obj.data.polygons:
        poly.material_index = 0
    return obj


def tri_count(obj) -> int:
    """Triangles of the evaluated mesh (modifiers applied)."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        return sum(len(p.vertices) - 2 for p in me.polygons)
    finally:
        ev.to_mesh_clear()


# --- AO ---------------------------------------------------------------------------------


def bake_ao(obj, samples: int = 64, distance: float = 4.0) -> None:
    """Bake Cycles AO (with a temporary 40 m ground plane) into COLOR_0.R only.

    Every other mesh is hidden from the render while baking, so LODs and variants that share
    the origin never occlude each other.
    """
    scene = bpy.context.scene
    set_engine(scene, "CYCLES")
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("tl_world")
    scene.world.light_settings.distance = distance

    hidden = {o.name: o.hide_render for o in scene.objects}
    for o in scene.objects:
        o.hide_render = o is not obj
    ground = _ground("tl_ao_ground", GROUND_SIZE_M)
    mesh = obj.data
    try:
        tmp = _color_attr(mesh, AO_TMP_ATTR)
        _make_active(mesh, AO_TMP_ATTR)
        _select_only([obj])
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        n = len(mesh.loops) * 4
        ao = [0.0] * n
        col = [0.0] * n
        tmp.data.foreach_get("color", ao)
        mesh.color_attributes[COLOR_ATTR].data.foreach_get("color", col)
        col[0::4] = [min(max(v, 0.0), 1.0) for v in ao[0::4]]
        mesh.color_attributes[COLOR_ATTR].data.foreach_set("color", col)
    finally:
        if mesh.color_attributes.get(AO_TMP_ATTR) is not None:
            mesh.color_attributes.remove(mesh.color_attributes[AO_TMP_ATTR])
        _make_active(mesh, COLOR_ATTR)
        ground_mesh = ground.data
        bpy.data.objects.remove(ground, do_unlink=True)
        bpy.data.meshes.remove(ground_mesh)
        for o in scene.objects:
            if o.name in hidden:
                o.hide_render = hidden[o.name]


# --- export -----------------------------------------------------------------------------


REQUIRED_EXPORT_PROPS = (
    "use_selection",
    "export_apply",
    "export_yup",
    "export_vertex_color",
    "export_all_vertex_colors",
)


def _exporter_props():
    return bpy.ops.export_scene.gltf.get_rna_type().properties


def _enum(props, key: str, wanted: str) -> str:
    """`wanted` if the installed exporter's enum `key` offers it; else a clear error."""
    items = [i.identifier for i in props[key].enum_items]
    if wanted not in items:
        raise RuntimeError(f"glTF exporter {key} lacks {wanted!r}; offers {items}")
    return wanted


def export_glb(objs: list, path: Path) -> None:
    """Export the selection as a y-up .glb, applying modifiers, active colour as COLOR_0."""
    props = _exporter_props()
    missing = [k for k in REQUIRED_EXPORT_PROPS if k not in props]
    if missing:
        raise RuntimeError(f"glTF exporter lacks required properties {missing}")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    for o in objs:
        _make_active(o.data, COLOR_ATTR)
    _select_only(objs)
    kw = {
        "filepath": str(path),
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
        "export_vertex_color": _enum(props, "export_vertex_color", "ACTIVE"),
        "export_all_vertex_colors": False,
        "export_materials": _enum(props, "export_materials", "EXPORT"),
        "export_image_format": _enum(props, "export_image_format", "NONE"),
        "export_texcoords": False,
        "export_normals": True,
        "export_tangents": False,
        "export_attributes": False,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_draco_mesh_compression_enable": False,
    }
    kw = {k: v for k, v in kw.items() if k == "filepath" or k in props}
    try:  # export_format is a dynamic enum that RNA under-reports
        bpy.ops.export_scene.gltf(export_format="GLB", **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    if not path.exists():
        raise RuntimeError(f"glTF export wrote nothing at {path}")


# --- preview ----------------------------------------------------------------------------

PREVIEW_COLORS = (  # role -> preview colour (linear RGB); display only
    (0.86, 0.84, 0.79),  # primary
    (0.20, 0.21, 0.24),  # secondary
    (0.55, 0.40, 0.26),  # accent
    (0.35, 0.50, 0.62),  # glass
    (0.08, 0.08, 0.09),  # dark
    (0.62, 0.64, 0.66),  # metal
    (0.22, 0.42, 0.18),  # foliage
    (0.98, 0.92, 0.70),  # light
)


def preview_material():
    """A preview-only material: role colour from COLOR_0.G, multiplied by the AO in R."""
    mat = bpy.data.materials.new("tl_preview")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = COLOR_ATTR
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    while len(els) < len(PREVIEW_COLORS):
        els.new(0.5)
    for i, (el, rgb) in enumerate(zip(els, PREVIEW_COLORS, strict=True)):
        el.position = max(0.0, (i - 0.5) / 7.0)
        el.color = (*rgb, 1.0)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    links = nt.links
    links.new(attr.outputs["Color"], sep.inputs[0])
    links.new(sep.outputs[1], ramp.inputs[0])
    rgba_in = [s for s in mix.inputs if s.type == "RGBA"]
    links.new(ramp.outputs["Color"], rgba_in[0])
    links.new(sep.outputs[0], rgba_in[1])
    rgba_out = next(s for s in mix.outputs if s.type == "RGBA")
    links.new(rgba_out, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


def sun_and_sky(scene) -> None:
    """A sun lamp and a sky texture world, for previews."""
    sun = bpy.data.lights.new("tl_sun", "SUN")
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new("tl_sun", sun)
    sun_obj.rotation_euler = (0.9, 0.0, 0.7)
    _link(sun_obj)
    world = scene.world or bpy.data.worlds.new("tl_world")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    sky = nt.nodes.new("ShaderNodeTexSky")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.6
