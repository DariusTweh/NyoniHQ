from pathlib import Path
import math
import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND_OUT = ROOT / "blender_output" / "NYONI_HQ_Company_Campus_v04.blend"
GLB_OUT = ROOT / "assets" / "3d" / "nyoni_company_campus_v04.glb"
POSTER_OUT = ROOT / "assets" / "3d" / "company_campus_isometric_v04.png"


def principled(material):
    material.use_nodes = True
    return material.node_tree.nodes.get("Principled BSDF")


def tune(name, color, roughness=0.48, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0):
    material = bpy.data.materials.get(name)
    if not material:
        material = bpy.data.materials.new(name)
    node = principled(material)
    node.inputs["Base Color"].default_value = (*color, alpha)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Alpha"].default_value = alpha
    if emission and "Emission Color" in node.inputs:
        node.inputs["Emission Color"].default_value = (*emission, 1.0)
        node.inputs["Emission Strength"].default_value = emission_strength
    material.diffuse_color = (*color, alpha)
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
    return material


PALETTE = {
    "MAT_HQ_BASE": ((0.32, 0.34, 0.31), 0.62),
    "MAT_HQ_CREAM": ((0.82, 0.79, 0.71), 0.52),
    "MAT_HQ_DARK": ((0.055, 0.075, 0.068), 0.42),
    "MAT_HQ_FLOOR": ((0.62, 0.59, 0.53), 0.66),
    "MAT_HQ_PATH": ((0.79, 0.75, 0.67), 0.55),
    "MAT_HQ_PLANT": ((0.20, 0.43, 0.22), 0.72),
    "MAT_HQ_POT": ((0.71, 0.64, 0.53), 0.66),
    "MAT_HQ_SCREEN": ((0.035, 0.085, 0.085), 0.24),
    "MAT_HQ_TRIM": ((0.58, 0.47, 0.29), 0.34),
    "MAT_SECOND_PASS_DARK": ((0.18, 0.22, 0.20), 0.48),
    "MAT_SECOND_PASS_MINT": ((0.48, 0.78, 0.65), 0.40),
    "MAT_SECOND_PASS_WARM": ((0.93, 0.72, 0.40), 0.34),
}
for material_name, (color, roughness) in PALETTE.items():
    tune(material_name, color, roughness)

glass = tune("MAT_HQ_GLASS", (0.72, 0.90, 0.84), 0.12, alpha=0.20)
glass.diffuse_color = (0.72, 0.90, 0.84, 0.20)

zone_colors = {
    "COMMERCIALS": (0.52, 0.72, 0.57),
    "STORY": (0.63, 0.57, 0.73),
    "CAMPAIGN": (0.73, 0.53, 0.61),
    "RESEARCH": (0.69, 0.65, 0.40),
    "MISSION_CONTROL": (0.51, 0.69, 0.64),
    "PHOTO": (0.72, 0.53, 0.62),
    "FINANCE": (0.48, 0.67, 0.61),
    "AUDIO": (0.74, 0.64, 0.38),
    "VIDEO": (0.48, 0.61, 0.77),
}
for zone, color in zone_colors.items():
    tune(f"MAT_ZONE_{zone}", color, 0.58)

plant_dark = tune("MAT_POLISH_PLANT_DARK", (0.13, 0.34, 0.16), 0.76)
plant_light = tune("MAT_POLISH_PLANT_LIGHT", (0.30, 0.55, 0.24), 0.70)
pot = tune("MAT_POLISH_POT", (0.74, 0.67, 0.56), 0.68)
glow = tune("MAT_POLISH_GLOW", (0.98, 0.74, 0.40), 0.24, emission=(1.0, 0.62, 0.28), emission_strength=3.5)

collection = bpy.data.collections.get("POLISH_V04") or bpy.data.collections.new("POLISH_V04")
if collection.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(collection)


def move_to_collection(obj):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def delete_object_tree(name):
    root = bpy.data.objects.get(name)
    if not root:
        return
    descendants = list(root.children_recursive)
    for obj in descendants + [root]:
        bpy.data.objects.remove(obj, do_unlink=True)


def add_box(name, location, dimensions, material, bevel=0.10):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft architectural edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    obj.data.materials.append(material)
    move_to_collection(obj)
    return obj


def add_planter(index, location, scale=1.0):
    x, y = location
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.42 * scale, depth=0.62 * scale, location=(x, y, 0.62 * scale))
    planter = bpy.context.object
    planter.name = f"POLISH_PLANTER_{index}"
    planter.data.materials.append(pot)
    move_to_collection(planter)
    for leaf_index in range(7):
        angle = leaf_index * math.tau / 7.0
        radius = (0.16 + 0.10 * (leaf_index % 2)) * scale
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.34 * scale, location=(x + math.cos(angle) * radius, y + math.sin(angle) * radius, (1.08 + 0.18 * (leaf_index % 3)) * scale))
        leaf = bpy.context.object
        leaf.name = f"POLISH_PLANT_{index}_LEAF_{leaf_index}"
        leaf.scale = (0.62, 0.38, 1.55)
        leaf.rotation_euler = (0.20 * math.sin(angle), 0.34 * math.cos(angle), angle)
        leaf.data.materials.append(plant_light if leaf_index % 3 == 0 else plant_dark)
        move_to_collection(leaf)


planters = [
    (-26.0, 16.0, 1.0), (-9.8, 16.0, 0.9), (9.8, 16.0, 0.9), (26.0, 16.0, 1.0),
    (-26.0, 5.0, 0.9), (-9.8, 5.0, 0.82), (9.8, 5.0, 0.82), (26.0, 5.0, 0.9),
    (-26.0, -6.0, 0.9), (-9.8, -6.0, 0.82), (9.8, -6.0, 0.82), (26.0, -6.0, 0.9),
    (-26.0, -16.0, 1.0), (-9.8, -16.0, 0.9), (9.8, -16.0, 0.9), (26.0, -16.0, 1.0),
    (-6.2, 4.8, 0.72), (6.2, 4.8, 0.72), (-6.2, -4.8, 0.72), (6.2, -4.8, 0.72),
]
for planter_index, (px, py, planter_scale) in enumerate(planters):
    add_planter(planter_index, (px, py), planter_scale)

# Mission Control cleanup: MIGO gets a clear director position instead of
# spawning under a desk inside the command table. The six bulky center seats
# are removed so the handoff path through the middle stays visually open.
delete_object_tree("DESK_MIGO")
for angle in (0, 60, 120, 180, 240, 300):
    delete_object_tree(f"MISSION_CONSOLE_{angle}")
for name in ("STATION_MIGO", "PREVIEW_MIGO"):
    station = bpy.data.objects.get(name)
    if station:
        station.location = (0.0, -3.62, 0.1)
        station.rotation_euler = (0.0, 0.0, 0.0)
mission_table = bpy.data.objects.get("MISSION_TABLE")
if mission_table:
    mission_table.scale.x *= 0.78
    mission_table.scale.y *= 0.78

# Give the command center one strong focal object: a restrained hologram
# floating above the table instead of loose chairs and consoles.
for ring_index, (major_radius, minor_radius, rotation) in enumerate([
    (1.15, 0.035, (math.radians(68), 0.0, math.radians(18))),
    (0.92, 0.030, (math.radians(22), math.radians(64), 0.0)),
    (0.72, 0.026, (0.0, math.radians(36), math.radians(72))),
]):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=48,
        minor_segments=8,
        location=(0.0, 0.0, 2.12),
        rotation=rotation,
    )
    hologram = bpy.context.object
    hologram.name = f"MISSION_HOLOGRAM_RING_{ring_index}"
    hologram.data.materials.append(tune("MAT_MISSION_HOLOGRAM", (0.28, 0.82, 0.70), 0.16, emission=(0.30, 1.0, 0.83), emission_strength=4.2))
    move_to_collection(hologram)

# Existing round-table seating now reads as intentional meeting rooms rather
# than chairs floating in open floor space.
for pod_index, (cx, cy) in enumerate([(-12.2, 12.3), (12.8, 12.0), (-12.3, 1.0)]):
    add_box(f"MEETING_POD_{pod_index}_BACK", (cx, cy + 2.55, 1.45), (5.6, 0.10, 2.35), glass, 0.06)
    add_box(f"MEETING_POD_{pod_index}_LEFT", (cx - 2.75, cy + 0.35, 1.45), (0.10, 4.5, 2.35), glass, 0.06)
    add_box(f"MEETING_POD_{pod_index}_RIGHT", (cx + 2.75, cy + 0.35, 1.45), (0.10, 4.5, 2.35), glass, 0.06)
    add_box(f"MEETING_POD_{pod_index}_HEADER", (cx, cy + 2.54, 2.73), (5.7, 0.18, 0.18), pot, 0.08)

for index, (x, y) in enumerate([(-27.2, -17.0), (-13.5, -17.0), (0.0, -17.0), (13.5, -17.0), (27.2, -17.0)]):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=0.22, location=(x, y, 0.62))
    lamp = bpy.context.object
    lamp.name = f"POLISH_FLOOR_LAMP_{index}"
    lamp.data.materials.append(glow)
    move_to_collection(lamp)

world = bpy.context.scene.world or bpy.data.worlds.new("NYONI_WORLD")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.80, 0.86, 0.82, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.44

for light in bpy.data.lights:
    light.energy *= 1.22
    if light.type == "AREA":
        light.color = (1.0, 0.91, 0.78)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1800
scene.render.resolution_y = 1050
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(POSTER_OUT)
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

for obj in bpy.context.scene.objects:
    obj.select_set(False)
export_collections = {"HQ_ARCHITECTURE", "HQ_FURNITURE", "HQ_LABELS", "HQ_NAVIGATION", "SECOND_PASS", "POLISH_V04"}
for collection_name in export_collections:
    export_collection = bpy.data.collections.get(collection_name)
    if export_collection:
        for obj in export_collection.all_objects:
            obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(GLB_OUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
)

for obj in bpy.context.scene.objects:
    obj.hide_render = False
bpy.ops.render.render(write_still=True)

print(f"Saved {BLEND_OUT}")
print(f"Exported {GLB_OUT}")
print(f"Rendered {POSTER_OUT}")
