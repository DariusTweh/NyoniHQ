import bpy
import math
import os
from mathutils import Vector


OUT = "/Users/dariustweh/Downloads/nyoni-hq-starter/blender_output"
os.makedirs(os.path.join(OUT, "renders"), exist_ok=True)
os.makedirs(os.path.join(OUT, "checkpoints"), exist_ok=True)
os.makedirs(os.path.join(OUT, "exports"), exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


reset_scene()
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
scene.render.resolution_x = 960
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world.color = (0.055, 0.07, 0.065)

root = bpy.data.collections.new("NYONI_HQ")
scene.collection.children.link(root)
collections = {}
for name in [
    "ARCHITECTURE",
    "WINDOWS_AND_GLASS",
    "FURNITURE",
    "WORKSTATIONS",
    "DECOR",
    "BOT_BASE",
    "AGENTS",
    "LIGHTING",
    "CAMERAS",
    "COLLISION_AND_NAVIGATION",
]:
    collection = bpy.data.collections.new(name)
    root.children.link(collection)
    collections[name] = collection


def move_to(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def make_material(
    name,
    color,
    roughness=0.5,
    metallic=0.0,
    alpha=1.0,
    emission=None,
    emission_strength=0.0,
):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    if bsdf.inputs.get("Base Color"):
        bsdf.inputs["Base Color"].default_value = (*color, 1)
    if bsdf.inputs.get("Roughness"):
        bsdf.inputs["Roughness"].default_value = roughness
    if bsdf.inputs.get("Metallic"):
        bsdf.inputs["Metallic"].default_value = metallic
    if bsdf.inputs.get("Alpha"):
        bsdf.inputs["Alpha"].default_value = alpha
    if emission and bsdf.inputs.get("Emission Color"):
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    material.diffuse_color = (*color, alpha)
    if alpha < 1:
        material.surface_render_method = "DITHERED"
    return material


def add_box(name, location, dimensions, material, collection, bevel=0.05, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    move_to(obj, collection)
    return obj


def add_cylinder(
    name,
    location,
    radius,
    depth,
    material,
    collection,
    vertices=32,
    rotation=(0, 0, 0),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    move_to(obj, collection)
    modifier = obj.modifiers.new("Soft bevel", "BEVEL")
    modifier.width = min(radius * 0.12, 0.06)
    modifier.segments = 3
    return obj


def add_uv_sphere(name, location, scale, material, collection):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    move_to(obj, collection)
    modifier = obj.modifiers.new("Soft bevel", "BEVEL")
    modifier.width = 0.025
    modifier.segments = 2
    return obj


def add_empty(name, location, rotation=(0, 0, 0), collection=None, display="PLAIN_AXES", size=0.35):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    obj.rotation_euler = rotation
    (collection or collections["COLLISION_AND_NAVIGATION"]).objects.link(obj)
    return obj


def rotated_offset(dx, dy, angle):
    return (
        dx * math.cos(angle) - dy * math.sin(angle),
        dx * math.sin(angle) + dy * math.cos(angle),
    )


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


ivory = make_material("MAT_IVORY_PLASTER", (0.88, 0.84, 0.74), 0.72)
white = make_material("MAT_SOFT_WHITE", (0.93, 0.91, 0.83), 0.48)
oak = make_material("MAT_PALE_OAK", (0.65, 0.42, 0.20), 0.55)
oak_light = make_material("MAT_LIGHT_OAK", (0.78, 0.58, 0.34), 0.5)
charcoal = make_material("MAT_CHARCOAL_METAL", (0.035, 0.045, 0.044), 0.26, 0.65)
stone = make_material("MAT_WARM_STONE", (0.55, 0.51, 0.44), 0.75)
glass = make_material("MAT_ARCH_GLASS", (0.32, 0.47, 0.48), 0.08, 0.0, 0.20)
green = make_material("MAT_SCOUT_GREEN", (0.30, 0.63, 0.42), 0.42)
lavender = make_material("MAT_CREATIVE_LAVENDER", (0.58, 0.39, 0.78), 0.42)
blue = make_material("MAT_PULSE_BLUE", (0.28, 0.56, 0.78), 0.42)
amber = make_material("MAT_HUNTER_AMBER", (0.82, 0.48, 0.18), 0.42)
rug_neutral = make_material("MAT_RUG_NEUTRAL", (0.55, 0.49, 0.39), 0.92)
screen = make_material("MAT_SCREEN_DARK", (0.015, 0.023, 0.025), 0.18, 0.05)
plant_green = make_material("MAT_PLANT_GREEN", (0.12, 0.34, 0.15), 0.7)
soil = make_material("MAT_SOIL", (0.12, 0.065, 0.025), 0.95)

# Architecture.
add_box("ARCH_FLOOR_SLAB", (0, 0, -0.18), (16.4, 12.4, 0.36), stone, collections["ARCHITECTURE"], 0.09)
add_box("ARCH_OAK_FLOOR", (0, 0, 0.015), (15.9, 11.9, 0.10), oak, collections["ARCHITECTURE"], 0.025)
add_box("ARCH_FRONT_EDGE", (0, -5.92, 0.28), (16.1, 0.16, 0.55), ivory, collections["ARCHITECTURE"], 0.035)
add_box("ARCH_LEFT_EDGE", (-7.92, -3.9, 0.28), (0.16, 4.1, 0.55), ivory, collections["ARCHITECTURE"], 0.035)
add_box("ARCH_BACK_WALL_LEFT", (-6.75, 5.88, 1.75), (2.5, 0.24, 3.5), ivory, collections["ARCHITECTURE"], 0.035)
add_box("ARCH_BACK_WALL_MID", (-1.15, 5.88, 1.75), (1.1, 0.24, 3.5), ivory, collections["ARCHITECTURE"], 0.035)
add_box("ARCH_BACK_TOP_BEAM", (2.2, 5.88, 3.25), (11.6, 0.24, 0.5), ivory, collections["ARCHITECTURE"], 0.035)
add_box("ARCH_RIGHT_TOP_BEAM", (7.88, 0.0, 3.25), (0.24, 12.0, 0.5), ivory, collections["ARCHITECTURE"], 0.035)

# Windows.
for i in range(7):
    x = -1.5 + i * 1.55
    add_box(f"WIN_BACK_FRAME_V_{i}", (x, 5.78, 1.65), (0.10, 0.10, 3.0), charcoal, collections["WINDOWS_AND_GLASS"], 0.015)
    if i < 6:
        add_box(f"WIN_BACK_GLASS_{i}", (x + 0.775, 5.84, 1.7), (1.43, 0.04, 2.85), glass, collections["WINDOWS_AND_GLASS"], 0)
add_box("WIN_BACK_SILL", (3.2, 5.78, 0.20), (9.45, 0.13, 0.16), charcoal, collections["WINDOWS_AND_GLASS"], 0.015)

right_window_y = [-5.5, -3.7, -1.9, -0.1, 1.7, 3.5, 5.3]
for i, y in enumerate(right_window_y):
    add_box(f"WIN_RIGHT_FRAME_V_{i}", (7.78, y, 1.65), (0.10, 0.10, 3.0), charcoal, collections["WINDOWS_AND_GLASS"], 0.015)
    if i < 6:
        add_box(f"WIN_RIGHT_GLASS_{i}", (7.84, y + 0.9, 1.7), (0.04, 1.68, 2.85), glass, collections["WINDOWS_AND_GLASS"], 0)
add_box("WIN_RIGHT_SILL", (7.78, 0, 0.20), (0.13, 11.7, 0.16), charcoal, collections["WINDOWS_AND_GLASS"], 0.015)

# Feature wall and glass meeting room.
for i in range(14):
    add_box(
        f"ARCH_SLAT_{i:02d}",
        (-5.8 + i * 0.18, 5.60, 1.75),
        (0.10, 0.16, 3.15),
        oak_light if i % 2 else oak,
        collections["ARCHITECTURE"],
        0.015,
    )
add_box("MEETING_GLASS_BACK", (-3.65, 4.35, 1.55), (5.4, 0.05, 3.0), glass, collections["WINDOWS_AND_GLASS"], 0)
add_box("MEETING_GLASS_SIDE", (-0.95, 3.0, 1.55), (0.05, 2.7, 3.0), glass, collections["WINDOWS_AND_GLASS"], 0)
for x in [-6.35, -3.65, -0.95]:
    add_box(f"MEETING_FRAME_BACK_{x}", (x, 4.34, 1.55), (0.08, 0.10, 3.0), charcoal, collections["WINDOWS_AND_GLASS"], 0.01)
for y in [1.65, 3.0, 4.35]:
    add_box(f"MEETING_FRAME_SIDE_{y}", (-0.95, y, 1.55), (0.10, 0.08, 3.0), charcoal, collections["WINDOWS_AND_GLASS"], 0.01)

# Workstation blockout and stable sockets.
stations = [
    ("SCOUT", (-5.2, -0.2, 0), 0, green),
    ("CREATIVE", (-4.25, -3.75, 0), 0, lavender),
    ("PULSE", (3.45, -3.75, 0), 0, blue),
    ("HUNTER", (5.35, -0.15, 0), math.radians(90), amber),
]
for ident, location, angle, accent in stations:
    add_empty(f"STATION_{ident}", (location[0], location[1], 0.1), (0, 0, angle))
    add_empty(f"APPROACH_{ident}", (location[0], location[1] - 1.35, 0.1), (0, 0, angle))
    add_box(f"RUG_{ident}", (location[0], location[1], 0.09), (3.5, 2.25, 0.035), accent, collections["WORKSTATIONS"], 0.10, (0, 0, angle))
    add_box(f"DESK_TOP_{ident}", (location[0], location[1], 0.78), (2.8, 0.85, 0.12), oak_light, collections["WORKSTATIONS"], 0.06, (0, 0, angle))
    for dx in (-1.22, 1.22):
        ox, oy = rotated_offset(dx, 0, angle)
        add_box(f"DESK_LEG_{ident}_{dx}", (location[0] + ox, location[1] + oy, 0.39), (0.10, 0.66, 0.78), charcoal, collections["WORKSTATIONS"], 0.025, (0, 0, angle))
    for monitor_index, dx in enumerate((-0.75, 0.75)):
        ox, oy = rotated_offset(dx, 0.05, angle)
        add_box(f"MONITOR_{ident}_{monitor_index}", (location[0] + ox, location[1] + oy, 1.36), (0.78, 0.10, 0.48), screen, collections["WORKSTATIONS"], 0.04, (math.radians(2), 0, angle))
    add_empty(f"BOT_SOCKET_{ident}", (location[0], location[1] - 0.78, 0.1), (0, 0, angle))

# Zone blockouts.
add_empty("ZONE_COLLABORATION", (0, 0.15, 0.1))
add_box("TABLE_COLLAB_BLOCKOUT", (0, 0.3, 0.72), (3.4, 1.45, 0.16), oak_light, collections["FURNITURE"], 0.28)
add_empty("ZONE_MEETING_ROOM", (-3.7, 3.05, 0.1))
add_box("TABLE_MEETING_BLOCKOUT", (-3.65, 3.05, 0.72), (3.2, 1.15, 0.14), oak_light, collections["FURNITURE"], 0.22)
add_empty("ZONE_LOUNGE", (4.2, 3.5, 0.1))
add_box("SOFA_BLOCKOUT", (4.1, 4.4, 0.5), (3.0, 0.95, 1.0), white, collections["FURNITURE"], 0.18)

for name, location in [
    ("WAYPOINT_ENTRY", (0, -5.3, 0.1)),
    ("WAYPOINT_CENTER", (0, -1.2, 0.1)),
    ("WAYPOINT_MEETING", (-2.0, 2.0, 0.1)),
    ("WAYPOINT_LOUNGE", (3.0, 2.2, 0.1)),
]:
    add_empty(name, location)

# Cameras.
camera_data = bpy.data.cameras.new("CAM_MAIN_ISO")
camera = bpy.data.objects.new("CAM_MAIN_ISO", camera_data)
collections["CAMERAS"].objects.link(camera)
camera.location = (18, -20, 17)
look_at(camera, (0, 0.35, 0.7))
camera.data.type = "ORTHO"
camera.data.ortho_scale = 23.5
scene.camera = camera

camera2_data = bpy.data.cameras.new("CAM_ELEVATED")
camera2 = bpy.data.objects.new("CAM_ELEVATED", camera2_data)
collections["CAMERAS"].objects.link(camera2)
camera2.location = (3, -2, 25)
look_at(camera2, (0, 0, 0))
camera2.data.type = "ORTHO"
camera2.data.ortho_scale = 22.0

# Lighting.
sun_data = bpy.data.lights.new("SUN_WARM", "SUN")
sun = bpy.data.objects.new("SUN_WARM", sun_data)
collections["LIGHTING"].objects.link(sun)
sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-125))
sun.data.energy = 2.2
sun.data.color = (1.0, 0.78, 0.55)
sun.data.angle = math.radians(8)

for name, location, energy, size, color in [
    ("AREA_WINDOW_KEY", (5, -2, 10), 1300, 7.0, (1.0, 0.78, 0.58)),
    ("AREA_SOFT_FILL", (-5, -1, 9), 900, 6.0, (0.62, 0.76, 1.0)),
    ("AREA_CEILING", (0, 2, 10), 700, 5.0, (1.0, 0.92, 0.75)),
]:
    light_data = bpy.data.lights.new(name, "AREA")
    light = bpy.data.objects.new(name, light_data)
    collections["LIGHTING"].objects.link(light)
    light.location = location
    look_at(light, (0, 0, 0))
    light.data.energy = energy
    light.data.shape = "DISK"
    light.data.size = size
    light.data.color = color

scene.render.filepath = os.path.join(OUT, "renders", "checkpoint_A_blockout.png")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "checkpoints", "NYONI_HQ_Commercials_checkpoint_A.blend"))
bpy.ops.render.render(write_still=True)
print("CHECKPOINT_A_OK", len(scene.objects), scene.render.filepath, bpy.data.filepath)

# Checkpoint B/C: finished modular furniture, decor, and four reusable bot variants.
fabric = make_material("MAT_CREAM_FABRIC", (0.72, 0.67, 0.57), 0.88)
fabric_light = make_material("MAT_LIGHT_CREAM_FABRIC", (0.86, 0.82, 0.72), 0.9)
paper = make_material("MAT_PAPER", (0.94, 0.92, 0.82), 0.82)
terracotta = make_material("MAT_TERRACOTTA", (0.50, 0.21, 0.11), 0.74)
white_shell = make_material("MAT_BOT_IVORY_SHELL", (0.88, 0.89, 0.84), 0.28)
bot_joint = make_material("MAT_BOT_JOINT", (0.11, 0.13, 0.13), 0.34, 0.25)


def add_chair(name, location, angle=0, upholstery=fabric):
    x, y = location
    seat = add_box(f"{name}_SEAT", (x, y, 0.50), (0.62, 0.62, 0.14), upholstery, collections["FURNITURE"], 0.10, (0, 0, angle))
    bx, by = rotated_offset(0, -0.28, angle)
    add_box(f"{name}_BACK", (x + bx, y + by, 0.88), (0.62, 0.16, 0.74), upholstery, collections["FURNITURE"], 0.12, (math.radians(-6), 0, angle))
    for index, (dx, dy) in enumerate([(-0.24, -0.23), (0.24, -0.23), (-0.24, 0.23), (0.24, 0.23)]):
        ox, oy = rotated_offset(dx, dy, angle)
        add_cylinder(f"{name}_LEG_{index}", (x + ox, y + oy, 0.24), 0.025, 0.48, charcoal, collections["FURNITURE"], 16)
    return seat


def add_plant(name, location, scale=1.0, pot_material=white):
    x, y = location
    add_cylinder(f"{name}_POT", (x, y, 0.28 * scale), 0.28 * scale, 0.55 * scale, pot_material, collections["DECOR"], 32)
    add_cylinder(f"{name}_SOIL", (x, y, 0.56 * scale), 0.245 * scale, 0.035 * scale, soil, collections["DECOR"], 32)
    for index, angle in enumerate([-58, -30, 0, 28, 57]):
        radians = math.radians(angle)
        leaf_x = x + math.sin(radians) * 0.34 * scale
        leaf_y = y + math.cos(radians) * 0.20 * scale
        leaf_z = 0.88 * scale + (index % 2) * 0.17 * scale
        leaf = add_uv_sphere(f"{name}_LEAF_{index}", (leaf_x, leaf_y, leaf_z), (0.16 * scale, 0.06 * scale, 0.42 * scale), plant_green, collections["DECOR"])
        leaf.rotation_euler = (math.radians(22), radians * 0.45, -radians)
    add_cylinder(f"{name}_STEM", (x, y, 0.83 * scale), 0.035 * scale, 0.65 * scale, plant_green, collections["DECOR"], 16)


def add_monitor_stand(name, location, angle=0):
    x, y, z = location
    add_cylinder(f"{name}_POST", (x, y, z), 0.035, 0.35, charcoal, collections["WORKSTATIONS"], 16)
    add_box(f"{name}_BASE", (x, y, z - 0.18), (0.36, 0.22, 0.04), charcoal, collections["WORKSTATIONS"], 0.02, (0, 0, angle))


# Workstation chairs, keyboards, tablets, books, and task lamps.
for ident, location, angle, accent in stations:
    x, y, _ = location
    ox, oy = rotated_offset(0, 0.95, angle)
    add_chair(f"CHAIR_{ident}", (x + ox, y + oy), angle, fabric)
    kx, ky = rotated_offset(0, 0.31, angle)
    add_box(f"KEYBOARD_{ident}", (x + kx, y + ky, 0.87), (0.72, 0.25, 0.035), charcoal, collections["WORKSTATIONS"], 0.025, (0, 0, angle))
    tx, ty = rotated_offset(0.93, -0.25, angle)
    add_box(f"TABLET_{ident}", (x + tx, y + ty, 0.88), (0.34, 0.25, 0.025), screen, collections["WORKSTATIONS"], 0.025, (0, 0, angle))
    nx, ny = rotated_offset(-0.95, -0.20, angle)
    add_box(f"NOTEBOOK_{ident}", (x + nx, y + ny, 0.89), (0.32, 0.23, 0.045), paper, collections["WORKSTATIONS"], 0.025, (0, 0, angle))
    for monitor_index, dx in enumerate((-0.75, 0.75)):
        sx, sy = rotated_offset(dx, 0.05, angle)
        add_monitor_stand(f"STAND_{ident}_{monitor_index}", (x + sx, y + sy, 1.05), angle)

# Creative gets a drawing tablet and standing mood board.
add_box("CREATIVE_DRAWING_TABLET", (-4.25, -4.05, 0.90), (0.70, 0.45, 0.04), screen, collections["WORKSTATIONS"], 0.035)
add_box("CREATIVE_MOOD_BOARD", (-6.45, -3.65, 1.45), (0.08, 1.55, 1.65), paper, collections["WORKSTATIONS"], 0.06)
for index, material in enumerate([lavender, amber, green, blue]):
    add_box(f"CREATIVE_SWATCH_{index}", (-6.39, -4.15 + index * 0.28, 1.62), (0.02, 0.18, 0.18), material, collections["DECOR"], 0.01)

# Central oval table details and chairs.
add_cylinder("COLLAB_PEDESTAL_A", (-0.75, 0.3, 0.39), 0.19, 0.68, charcoal, collections["FURNITURE"], 32)
add_cylinder("COLLAB_PEDESTAL_B", (0.75, 0.3, 0.39), 0.19, 0.68, charcoal, collections["FURNITURE"], 32)
for index, (x, y, angle) in enumerate([
    (-1.25, -0.72, 0), (0, -0.72, 0), (1.25, -0.72, 0),
    (-1.25, 1.32, math.pi), (0, 1.32, math.pi), (1.25, 1.32, math.pi),
]):
    add_chair(f"CHAIR_COLLAB_{index}", (x, y), angle, fabric_light)
add_cylinder("COLLAB_PLANTER", (0, 0.3, 0.93), 0.14, 0.20, white, collections["DECOR"], 32)
add_uv_sphere("COLLAB_PLANT", (0, 0.3, 1.13), (0.28, 0.28, 0.24), plant_green, collections["DECOR"])

# Mobile whiteboard beside collaboration zone.
add_box("WHITEBOARD_PANEL", (1.95, 1.5, 1.35), (1.75, 0.10, 1.15), paper, collections["FURNITURE"], 0.07, (0, 0, math.radians(90)))
for x in (1.53, 2.37):
    add_cylinder(f"WHITEBOARD_LEG_{x}", (x, 1.5, 0.62), 0.035, 1.10, charcoal, collections["FURNITURE"], 16)

# Meeting room chairs, display, and pendant.
for index, (x, y, angle) in enumerate([
    (-4.65, 2.18, 0), (-3.55, 2.18, 0), (-2.45, 2.18, 0),
    (-4.65, 3.92, math.pi), (-3.55, 3.92, math.pi), (-2.45, 3.92, math.pi),
]):
    add_chair(f"CHAIR_MEETING_{index}", (x, y), angle, fabric_light)
add_box("MEETING_DISPLAY", (-5.75, 5.67, 1.78), (1.55, 0.09, 0.88), screen, collections["FURNITURE"], 0.06)
bpy.ops.mesh.primitive_torus_add(major_radius=0.58, minor_radius=0.055, major_segments=48, minor_segments=12, location=(-3.65, 3.05, 2.75))
pendant = bpy.context.object
pendant.name = "MEETING_RING_PENDANT"
pendant.data.materials.append(amber)
move_to(pendant, collections["DECOR"])

# Lounge: sofa cushions, rug, coffee table, armchair, floor lamp.
sofa = bpy.data.objects.get("SOFA_BLOCKOUT")
if sofa:
    sofa.name = "LOUNGE_SOFA_BASE"
add_box("LOUNGE_SOFA_BACK", (4.1, 4.78, 0.92), (3.0, 0.30, 1.10), fabric_light, collections["FURNITURE"], 0.18)
add_box("LOUNGE_SOFA_ARM_L", (2.67, 4.4, 0.73), (0.32, 0.92, 0.84), fabric_light, collections["FURNITURE"], 0.14)
add_box("LOUNGE_SOFA_ARM_R", (5.53, 4.4, 0.73), (0.32, 0.92, 0.84), fabric_light, collections["FURNITURE"], 0.14)
for index, x in enumerate([3.2, 4.1, 5.0]):
    add_box(f"LOUNGE_CUSHION_{index}", (x, 4.29, 0.90), (0.68, 0.20, 0.58), white if index != 1 else amber, collections["FURNITURE"], 0.13)
add_box("LOUNGE_RUG", (4.05, 3.55, 0.09), (4.6, 2.9, 0.04), rug_neutral, collections["FURNITURE"], 0.16)
add_cylinder("LOUNGE_COFFEE_TOP", (4.0, 3.28, 0.48), 0.72, 0.12, oak_light, collections["FURNITURE"], 48)
add_cylinder("LOUNGE_COFFEE_BASE", (4.0, 3.28, 0.25), 0.14, 0.45, charcoal, collections["FURNITURE"], 24)
add_chair("LOUNGE_ARMCHAIR", (6.25, 3.35), math.radians(-90), fabric_light)
add_cylinder("LOUNGE_LAMP_STEM", (6.75, 4.65, 1.15), 0.035, 2.2, charcoal, collections["DECOR"], 16)
add_cylinder("LOUNGE_LAMP_SHADE", (6.75, 4.65, 2.28), 0.35, 0.42, amber, collections["DECOR"], 32)

# Modular shelving with books and boxes.
for x in [-7.15, -5.95]:
    add_box(f"SHELF_UPRIGHT_{x}", (x, 4.72, 1.45), (0.10, 0.48, 2.55), charcoal, collections["FURNITURE"], 0.02)
for level in range(5):
    z = 0.30 + level * 0.52
    add_box(f"SHELF_BOARD_{level}", (-6.55, 4.72, z), (1.30, 0.48, 0.08), oak_light, collections["FURNITURE"], 0.025)
    for book_index in range(4):
        add_box(f"BOOK_{level}_{book_index}", (-6.95 + book_index * 0.22, 4.70, z + 0.20), (0.13, 0.28, 0.30 + (book_index % 2) * 0.08), paper if book_index % 2 else charcoal, collections["DECOR"], 0.012)

# Plants at visual anchors.
for name, location, scale, material in [
    ("PLANT_ENTRY", (-7.05, -4.85), 1.05, white),
    ("PLANT_MEETING", (-6.65, 3.72), 0.85, terracotta),
    ("PLANT_WINDOW_A", (1.45, 5.15), 0.95, white),
    ("PLANT_WINDOW_B", (6.95, 5.05), 0.85, terracotta),
    ("PLANT_LOUNGE", (6.65, 2.20), 0.78, white),
    ("PLANT_CENTER", (1.55, -1.25), 0.62, terracotta),
]:
    add_plant(name, location, scale, material)

# Minimal wall identity.
font_curve = bpy.data.curves.new("SIGNAGE_TEXT_CURVE", type="FONT")
font_curve.body = "NYONI / COMMERCIALS"
font_curve.align_x = "CENTER"
font_curve.size = 0.27
font_curve.extrude = 0.015
sign = bpy.data.objects.new("SIGNAGE_NYONI_COMMERCIALS", font_curve)
collections["DECOR"].objects.link(sign)
sign.location = (-5.9, 5.43, 2.72)
sign.rotation_euler = (math.radians(90), 0, 0)
font_curve.materials.append(charcoal)


def parent_keep_world(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def world_point(base, local, angle):
    ox, oy = rotated_offset(local[0], local[1], angle)
    return (base[0] + ox, base[1] + oy, base[2] + local[2])


def add_bot(agent_id, base, angle, accent):
    root_obj = add_empty(f"AGENT_{agent_id}", base, (0, 0, angle), collections["AGENTS"], "CUBE", 0.52)
    root_obj["agent_id"] = f"AGENT_{agent_id}"
    root_obj["station_id"] = f"STATION_{agent_id}"
    root_obj["interactive"] = True
    eye_material = make_material(f"MAT_{agent_id}_EYES", accent.diffuse_color[:3], 0.22, 0, 1, accent.diffuse_color[:3], 4.0)

    parts = []
    parts.append(add_uv_sphere(f"{agent_id}_BODY", world_point(base, (0, 0, 0.48), angle), (0.26, 0.21, 0.31), white_shell, collections["AGENTS"]))
    head = add_box(f"{agent_id}_HEAD", world_point(base, (0, 0.02, 0.95), angle), (0.62, 0.48, 0.46), white_shell, collections["AGENTS"], 0.18, (0, 0, angle))
    parts.append(head)
    face = add_box(f"{agent_id}_FACE_SCREEN", world_point(base, (0, 0.265, 0.95), angle), (0.49, 0.035, 0.31), screen, collections["AGENTS"], 0.10, (0, 0, angle))
    parts.append(face)
    for side in (-1, 1):
        eye = add_box(f"{agent_id}_EYE_{side}", world_point(base, (0.115 * side, 0.287, 0.99), angle), (0.065, 0.018, 0.105), eye_material, collections["AGENTS"], 0.03, (0, 0, angle))
        parts.append(eye)
        ear = add_cylinder(f"{agent_id}_EAR_{side}", world_point(base, (0.335 * side, 0.02, 0.96), angle), 0.11, 0.08, accent, collections["AGENTS"], 24, (0, math.radians(90), angle))
        parts.append(ear)
    add_cylinder(f"{agent_id}_ANTENNA", world_point(base, (0, 0.02, 1.31), angle), 0.025, 0.20, charcoal, collections["AGENTS"], 16)
    antenna_ball = add_uv_sphere(f"{agent_id}_ANTENNA_BALL", world_point(base, (0, 0.02, 1.44), angle), (0.075, 0.075, 0.075), accent, collections["AGENTS"])
    parts.append(antenna_ball)
    chest = add_cylinder(f"{agent_id}_CHEST_BADGE", world_point(base, (0, 0.205, 0.52), angle), 0.085, 0.035, accent, collections["AGENTS"], 24, (math.radians(90), 0, angle))
    parts.append(chest)
    for side in (-1, 1):
        shoulder = world_point(base, (0.27 * side, 0, 0.64), angle)
        hand = world_point(base, (0.30 * side, 0.25, 0.76), angle)
        mid = tuple((shoulder[i] + hand[i]) / 2 for i in range(3))
        direction = Vector(hand) - Vector(shoulder)
        arm = add_cylinder(f"{agent_id}_ARM_{side}", mid, 0.075, direction.length, white_shell, collections["AGENTS"], 20)
        arm.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
        parts.append(arm)
        parts.append(add_uv_sphere(f"{agent_id}_HAND_{side}", hand, (0.085, 0.085, 0.085), white_shell, collections["AGENTS"]))
        foot = world_point(base, (0.15 * side, 0.04, 0.12), angle)
        parts.append(add_box(f"{agent_id}_FOOT_{side}", foot, (0.22, 0.34, 0.15), bot_joint, collections["AGENTS"], 0.07, (0, 0, angle)))
    for part in parts:
        parent_keep_world(part, root_obj)
    return root_obj


bot_positions = {
    "SCOUT": ((-5.2, 0.60, 0.10), math.pi, green),
    "CREATIVE": ((-4.25, -2.95, 0.10), math.pi, lavender),
    "PULSE": ((3.45, -2.95, 0.10), math.pi, blue),
    "HUNTER": ((4.55, -0.15, 0.10), math.radians(-90), amber),
}
for agent_id, (base, angle, accent) in bot_positions.items():
    add_bot(agent_id, base, angle, accent)

# Additional agent camera targets.
for name, location in [
    ("CAM_TARGET_SCOUT", (-5.2, -0.6, 0.85)),
    ("CAM_TARGET_BOT", (-5.2, -1.0, 0.85)),
]:
    add_empty(name, location, collection=collections["CAMERAS"])

scout_cam_data = bpy.data.cameras.new("CAM_SCOUT_CLOSEUP")
scout_cam = bpy.data.objects.new("CAM_SCOUT_CLOSEUP", scout_cam_data)
collections["CAMERAS"].objects.link(scout_cam)
scout_cam.location = (-5.2, -4.2, 2.55)
look_at(scout_cam, (-5.2, 0.05, 0.88))
scout_cam.data.type = "PERSP"
scout_cam.data.lens = 55

bot_cam_data = bpy.data.cameras.new("CAM_BOT_CLOSEUP")
bot_cam = bpy.data.objects.new("CAM_BOT_CLOSEUP", bot_cam_data)
collections["CAMERAS"].objects.link(bot_cam)
bot_cam.location = (-5.2, -2.15, 1.55)
look_at(bot_cam, (-5.2, 0.52, 0.93))
bot_cam.data.type = "PERSP"
bot_cam.data.lens = 68

# Save checkpoint B/C and final review renders.
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "checkpoints", "NYONI_HQ_Commercials_checkpoint_C.blend"))
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080

for camera_obj, filename in [
    (camera, "commercials_isometric.png"),
    (camera2, "commercials_elevated.png"),
    (scout_cam, "scout_closeup.png"),
    (bot_cam, "bot_closeup.png"),
]:
    scene.camera = camera_obj
    scene.render.filepath = os.path.join(OUT, "renders", filename)
    bpy.ops.render.render(write_still=True)

scene.camera = camera
final_blend = os.path.join(OUT, "NYONI_HQ_Commercials_v01.blend")
bpy.ops.wm.save_as_mainfile(filepath=final_blend)
print("CHECKPOINT_C_OK", len(scene.objects), final_blend)
