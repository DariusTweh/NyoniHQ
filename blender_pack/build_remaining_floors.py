import bpy
import json
import math
import os
from mathutils import Vector


ROOT = "/Users/dariustweh/Downloads/nyoni-hq-starter"
OUT = os.path.join(ROOT, "blender_output")
EXPORT_DIR = os.path.join(OUT, "exports")
RENDER_DIR = os.path.join(OUT, "renders")
CHECKPOINT_DIR = os.path.join(OUT, "checkpoints")
for path in (OUT, EXPORT_DIR, RENDER_DIR, CHECKPOINT_DIR):
    os.makedirs(path, exist_ok=True)


def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def configure_scene():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.fps = 24
    scene.world.color = (0.035, 0.050, 0.045)
    return scene


def create_collections(slug):
    root = bpy.data.collections.new(f"NYONI_HQ_{slug.upper()}")
    bpy.context.scene.collection.children.link(root)
    names = [
        "ARCHITECTURE",
        "WINDOWS_AND_GLASS",
        "FURNITURE",
        "WORKSTATIONS",
        "DECOR",
        "AGENTS",
        "LIGHTING",
        "CAMERAS",
        "COLLISION_AND_NAVIGATION",
    ]
    collections = {}
    for name in names:
        collection = bpy.data.collections.new(name)
        root.children.link(collection)
        collections[name] = collection
    return root, collections


def material(name, color, roughness=0.5, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color[:3], alpha)
    bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if emission and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1:
        mat.surface_render_method = "DITHERED"
        mat.use_transparency_overlap = False
    return mat


def make_palette(slug, accent, accent2):
    return {
        "ivory": material(f"{slug}_IVORY", (0.87, 0.84, 0.75), 0.56),
        "white": material(f"{slug}_WHITE", (0.94, 0.93, 0.86), 0.48),
        "oak": material(f"{slug}_OAK", (0.58, 0.39, 0.22), 0.60),
        "oak_light": material(f"{slug}_OAK_LIGHT", (0.76, 0.59, 0.38), 0.57),
        "stone": material(f"{slug}_STONE", (0.30, 0.32, 0.29), 0.72),
        "charcoal": material(f"{slug}_CHARCOAL", (0.025, 0.035, 0.035), 0.30, 0.35),
        "screen": material(f"{slug}_SCREEN", (0.012, 0.025, 0.030), 0.20, 0.08),
        "glass": material(f"{slug}_GLASS", (0.36, 0.58, 0.60), 0.18, 0.05, alpha=0.24),
        "fabric": material(f"{slug}_FABRIC", (0.62, 0.61, 0.55), 0.88),
        "paper": material(f"{slug}_PAPER", (0.88, 0.85, 0.72), 0.77),
        "green": material(f"{slug}_PLANT", (0.19, 0.36, 0.20), 0.75),
        "soil": material(f"{slug}_SOIL", (0.08, 0.045, 0.025), 0.95),
        "accent": material(f"{slug}_ACCENT_A", accent, 0.42),
        "accent2": material(f"{slug}_ACCENT_B", accent2, 0.42),
        "glow": material(f"{slug}_GLOW", accent, 0.20, emission=accent, emission_strength=2.2),
    }


def link_only(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def add_box(name, location, dimensions, mat, collection, bevel=0.05, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    obj.data.materials.append(mat)
    return link_only(obj, collection)


def add_cylinder(name, location, radius, depth, mat, collection, vertices=32, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("Soft edges", "BEVEL")
    bevel.width = min(radius * 0.12, 0.045)
    bevel.segments = 3
    return link_only(obj, collection)


def add_sphere(name, location, scale, mat, collection):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return link_only(obj, collection)


def add_torus(name, location, major_radius, minor_radius, mat, collection, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=48,
        minor_segments=10,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return link_only(obj, collection)


def add_empty(name, location, collection, rotation=(0, 0, 0), size=0.32):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = size
    obj.location = location
    obj.rotation_euler = rotation
    collection.objects.link(obj)
    return obj


def add_text(name, body, location, scale, mat, collection, rotation=(math.pi / 2, 0, 0)):
    curve = bpy.data.curves.new(f"{name}_CURVE", "FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.018
    curve.bevel_depth = 0.006
    obj = bpy.data.objects.new(name, curve)
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = (scale, scale, scale)
    obj.data.materials.append(mat)
    collection.objects.link(obj)
    return obj


def world_point(base, local, angle):
    x, y, z = local
    c, s = math.cos(angle), math.sin(angle)
    return (base[0] + x * c - y * s, base[1] + x * s + y * c, base[2] + z)


def add_chair(name, location, angle, mats, collection, upholstery=None):
    upholstery = upholstery or mats["fabric"]
    x, y = location
    add_box(f"{name}_SEAT", (x, y, 0.50), (0.62, 0.62, 0.14), upholstery, collection, 0.10, (0, 0, angle))
    bx, by, _ = world_point((x, y, 0), (0, -0.28, 0), angle)
    add_box(f"{name}_BACK", (bx, by, 0.90), (0.62, 0.16, 0.72), upholstery, collection, 0.12, (math.radians(-5), 0, angle))
    for index, (ox, oy) in enumerate(((-0.24, -0.22), (0.24, -0.22), (-0.24, 0.22), (0.24, 0.22))):
        px, py, _ = world_point((x, y, 0), (ox, oy, 0), angle)
        add_cylinder(f"{name}_LEG_{index}", (px, py, 0.24), 0.025, 0.48, mats["charcoal"], collection, 14)


def add_monitor(name, location, angle, mats, accent=None, wide=False):
    width = 1.10 if wide else 0.82
    add_box(name, location, (width, 0.10, 0.52), mats["screen"], collections["WORKSTATIONS"], 0.045, (0, 0, angle))
    x, y, z = location
    add_cylinder(f"{name}_POST", (x, y, z - 0.37), 0.035, 0.34, mats["charcoal"], collections["WORKSTATIONS"], 14)
    add_box(f"{name}_BASE", (x, y, z - 0.55), (0.36, 0.24, 0.04), mats["charcoal"], collections["WORKSTATIONS"], 0.02, (0, 0, angle))
    if accent:
        add_box(f"{name}_UI", world_point(location, (0, -0.056, 0.02), angle), (width * 0.68, 0.012, 0.10), accent, collections["WORKSTATIONS"], 0.015, (0, 0, angle))


def add_desk(name, location, angle, mats, accent, monitors=2, width=2.7):
    x, y = location
    add_empty(f"STATION_{name}", (x, y, 0.1), collections["COLLISION_AND_NAVIGATION"], (0, 0, angle))
    add_box(f"RUG_{name}", (x, y, 0.09), (width + 0.9, 2.15, 0.04), accent, collections["WORKSTATIONS"], 0.12, (0, 0, angle))
    add_box(f"DESK_{name}", (x, y, 0.78), (width, 0.82, 0.12), mats["oak_light"], collections["WORKSTATIONS"], 0.07, (0, 0, angle))
    for side in (-1, 1):
        px, py, _ = world_point((x, y, 0), (side * (width / 2 - 0.18), 0, 0), angle)
        add_box(f"DESK_{name}_LEG_{side}", (px, py, 0.39), (0.10, 0.64, 0.78), mats["charcoal"], collections["WORKSTATIONS"], 0.025, (0, 0, angle))
    offsets = [0] if monitors == 1 else ([-0.52, 0.52] if monitors == 2 else [-0.78, 0, 0.78])
    for index, offset in enumerate(offsets):
        mx, my, _ = world_point((x, y, 0), (offset, -0.26, 0), angle)
        add_monitor(f"MONITOR_{name}_{index}", (mx, my, 1.37), angle, mats, accent)
    kx, ky, _ = world_point((x, y, 0), (0, 0.16, 0), angle)
    add_box(f"KEYBOARD_{name}", (kx, ky, 0.88), (0.72, 0.25, 0.035), mats["charcoal"], collections["WORKSTATIONS"], 0.025, (0, 0, angle))


def add_sofa(name, location, angle, mats, accent, width=2.8):
    x, y = location
    add_box(f"{name}_BASE", (x, y, 0.48), (width, 0.88, 0.38), mats["fabric"], collections["FURNITURE"], 0.16, (0, 0, angle))
    bx, by, _ = world_point((x, y, 0), (0, -0.38, 0), angle)
    add_box(f"{name}_BACK", (bx, by, 0.92), (width, 0.26, 1.02), mats["fabric"], collections["FURNITURE"], 0.18, (0, 0, angle))
    for side in (-1, 1):
        ax, ay, _ = world_point((x, y, 0), (side * (width / 2 - 0.14), 0, 0), angle)
        add_box(f"{name}_ARM_{side}", (ax, ay, 0.70), (0.28, 0.86, 0.74), mats["fabric"], collections["FURNITURE"], 0.13, (0, 0, angle))
    add_box(f"{name}_CUSHION", world_point((x, y, 0.72), (0, 0.05, 0), angle), (0.78, 0.18, 0.50), accent, collections["DECOR"], 0.14, (0, 0, angle))


def add_plant(name, location, mats, scale=1.0):
    x, y = location
    add_cylinder(f"{name}_POT", (x, y, 0.28 * scale), 0.28 * scale, 0.55 * scale, mats["white"], collections["DECOR"], 28)
    add_cylinder(f"{name}_STEM", (x, y, 0.82 * scale), 0.035 * scale, 0.72 * scale, mats["green"], collections["DECOR"], 12)
    for index, (ox, oy, oz, rz) in enumerate(((-0.16, 0, 1.05, -20), (0.16, 0, 1.12, 20), (0, 0.12, 1.30, 0), (0.08, -0.12, 0.94, 30))):
        leaf = add_sphere(f"{name}_LEAF_{index}", (x + ox * scale, y + oy * scale, oz * scale), (0.15 * scale, 0.055 * scale, 0.38 * scale), mats["green"], collections["DECOR"])
        leaf.rotation_euler = (0, math.radians(rz), math.radians(rz))


def add_bot(agent_id, base, angle, accent, mats):
    root = add_empty(f"AGENT_{agent_id}", base, collections["AGENTS"], (0, 0, angle), 0.5)
    root["agent_id"] = f"AGENT_{agent_id}"
    shell = mats["white"]
    joint = mats["charcoal"]
    eye = material(f"MAT_{agent_id}_EYES", accent.diffuse_color[:3], 0.2, emission=accent.diffuse_color[:3], emission_strength=2.5)
    parts = []
    parts.append(add_sphere(f"{agent_id}_BODY", world_point(base, (0, 0, 0.48), angle), (0.26, 0.21, 0.31), shell, collections["AGENTS"]))
    parts.append(add_box(f"{agent_id}_HEAD", world_point(base, (0, 0.02, 0.95), angle), (0.62, 0.48, 0.46), shell, collections["AGENTS"], 0.18, (0, 0, angle)))
    parts.append(add_box(f"{agent_id}_FACE", world_point(base, (0, 0.265, 0.95), angle), (0.49, 0.035, 0.31), mats["screen"], collections["AGENTS"], 0.10, (0, 0, angle)))
    for side in (-1, 1):
        parts.append(add_box(f"{agent_id}_EYE_{side}", world_point(base, (0.115 * side, 0.287, 0.99), angle), (0.065, 0.018, 0.105), eye, collections["AGENTS"], 0.03, (0, 0, angle)))
        hand = world_point(base, (0.36 * side, 0.04, 0.48), angle)
        parts.append(add_cylinder(f"{agent_id}_ARM_{side}", world_point(base, (0.30 * side, 0.02, 0.57), angle), 0.065, 0.34, shell, collections["AGENTS"], 18, (0, math.radians(12 * side), angle)))
        parts.append(add_sphere(f"{agent_id}_HAND_{side}", hand, (0.08, 0.08, 0.08), shell, collections["AGENTS"]))
        parts.append(add_box(f"{agent_id}_FOOT_{side}", world_point(base, (0.13 * side, 0.02, 0.13), angle), (0.22, 0.34, 0.15), joint, collections["AGENTS"], 0.07, (0, 0, angle)))
    parts.append(add_cylinder(f"{agent_id}_ANTENNA", world_point(base, (0, 0.02, 1.32), angle), 0.024, 0.20, joint, collections["AGENTS"], 14))
    parts.append(add_sphere(f"{agent_id}_ANTENNA_BALL", world_point(base, (0, 0.02, 1.45), angle), (0.07, 0.07, 0.07), accent, collections["AGENTS"]))
    for part in parts:
        part.parent = root
        part.matrix_parent_inverse = root.matrix_world.inverted()
    return root


def add_shell(label, mats, floor_mat=None):
    floor_mat = floor_mat or mats["oak"]
    add_box("ARCH_FLOOR_SLAB", (0, 0, -0.18), (16.4, 12.4, 0.36), mats["stone"], collections["ARCHITECTURE"], 0.09)
    add_box("ARCH_FINISH_FLOOR", (0, 0, 0.015), (15.9, 11.9, 0.10), floor_mat, collections["ARCHITECTURE"], 0.025)
    add_box("ARCH_FRONT_EDGE", (0, -5.92, 0.28), (16.1, 0.16, 0.55), mats["ivory"], collections["ARCHITECTURE"], 0.035)
    add_box("ARCH_LEFT_EDGE", (-7.92, -3.9, 0.28), (0.16, 4.1, 0.55), mats["ivory"], collections["ARCHITECTURE"], 0.035)
    add_box("ARCH_BACK_WALL", (-5.85, 5.88, 1.75), (4.1, 0.24, 3.5), mats["ivory"], collections["ARCHITECTURE"], 0.035)
    add_box("ARCH_BACK_TOP", (2.2, 5.88, 3.25), (11.6, 0.24, 0.5), mats["ivory"], collections["ARCHITECTURE"], 0.035)
    add_box("ARCH_RIGHT_TOP", (7.88, 0, 3.25), (0.24, 12.0, 0.5), mats["ivory"], collections["ARCHITECTURE"], 0.035)
    for i, x in enumerate([-3.7, -2.05, -0.4, 1.25, 2.9, 4.55, 6.2, 7.78]):
        add_box(f"WIN_BACK_FRAME_{i}", (x, 5.78, 1.65), (0.10, 0.10, 3.0), mats["charcoal"], collections["WINDOWS_AND_GLASS"], 0.015)
        if i < 7:
            add_box(f"WIN_BACK_GLASS_{i}", (x + 0.825, 5.84, 1.7), (1.54, 0.04, 2.85), mats["glass"], collections["WINDOWS_AND_GLASS"], 0)
    for i, y in enumerate([-5.75, -3.8, -1.85, 0.10, 2.05, 4.0, 5.75]):
        add_box(f"WIN_RIGHT_FRAME_{i}", (7.78, y, 1.65), (0.10, 0.10, 3.0), mats["charcoal"], collections["WINDOWS_AND_GLASS"], 0.015)
        if i < 6:
            add_box(f"WIN_RIGHT_GLASS_{i}", (7.84, y + 0.975, 1.7), (0.04, 1.82, 2.85), mats["glass"], collections["WINDOWS_AND_GLASS"], 0)
    add_text("FLOOR_SIGN", label, (-5.9, 5.59, 2.60), 0.32, mats["charcoal"], collections["DECOR"], (math.pi / 2, 0, 0))
    add_plant("PLANT_WINDOW_A", (6.7, 4.6), mats, 0.85)
    add_plant("PLANT_WINDOW_B", (6.8, -4.8), mats, 0.72)


def add_camera_and_lights(slug, mats):
    camera_data = bpy.data.cameras.new("CAM_MAIN_ISO")
    camera = bpy.data.objects.new("CAM_MAIN_ISO", camera_data)
    collections["CAMERAS"].objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 23.5
    camera.location = (18.0, -20.0, 17.0)
    target = Vector((0, 0, 0.75))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 52
    elevated_data = bpy.data.cameras.new("CAM_ELEVATED")
    elevated = bpy.data.objects.new("CAM_ELEVATED", elevated_data)
    collections["CAMERAS"].objects.link(elevated)
    elevated.data.type = "ORTHO"
    elevated.data.ortho_scale = 21.5
    elevated.location = (4.0, -5.0, 24.0)
    elevated.rotation_euler = (target - elevated.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    sun_data = bpy.data.lights.new("SUN_KEY", "SUN")
    sun_data.energy = 2.0
    sun_data.angle = math.radians(12)
    sun = bpy.data.objects.new("SUN_KEY", sun_data)
    sun.rotation_euler = (math.radians(32), math.radians(-22), math.radians(-35))
    collections["LIGHTING"].objects.link(sun)
    for name, location, energy, size, color in (
        ("AREA_WINDOW", (6, -1, 9), 1100, 7.0, (1.0, 0.83, 0.64)),
        ("AREA_FILL", (-5, -3, 8), 900, 6.0, (0.74, 0.87, 1.0)),
        ("AREA_CENTER", (0, 1, 9), 750, 5.0, (1.0, 0.92, 0.76)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat("-Z", "Y").to_euler()
        collections["LIGHTING"].objects.link(light)
    return camera, elevated


def add_wall_screen(name, location, dimensions, mats, accent, rotation=(0, 0, 0)):
    add_box(f"{name}_FRAME", location, dimensions, mats["charcoal"], collections["FURNITURE"], 0.08, rotation)
    inset = (dimensions[0] * 0.90, max(0.025, dimensions[1] * 0.20), dimensions[2] * 0.82)
    offset = world_point(location, (0, -dimensions[1] * 0.52, 0), rotation[2])
    add_box(f"{name}_SCREEN", offset, inset, mats["screen"], collections["FURNITURE"], 0.04, rotation)
    for row in range(3):
        add_box(f"{name}_DATA_{row}", world_point(offset, (-dimensions[0] * 0.18, -0.02, 0.18 - row * 0.18), rotation[2]), (dimensions[0] * (0.45 + row * 0.1), 0.012, 0.035), accent, collections["DECOR"], 0.01, rotation)


def build_entertainment(mats):
    add_shell("NYONI / ENTERTAINMENT", mats)
    coral = material("MAT_STORY_CORAL", (0.82, 0.42, 0.38), 0.43)
    blue = material("MAT_MOTION_BLUE", (0.35, 0.56, 0.85), 0.40)
    lavender = material("MAT_CREATIVE_LAVENDER", (0.58, 0.39, 0.78), 0.42)
    add_desk("STORY", (-4.7, -3.5), 0, mats, coral, 2)
    add_desk("MOTION", (4.5, -3.5), 0, mats, blue, 3, 3.2)
    add_desk("CREATIVE", (-0.2, 2.8), math.pi, mats, lavender, 1, 2.6)
    add_chair("CHAIR_STORY", (-4.7, -2.75), math.pi, mats, collections["FURNITURE"])
    add_chair("CHAIR_MOTION", (4.5, -2.75), math.pi, mats, collections["FURNITURE"])
    add_chair("CHAIR_CREATIVE", (-0.2, 2.05), 0, mats, collections["FURNITURE"])

    # Writers' table and wall of story cards.
    add_box("WRITERS_RUG", (-3.7, 1.9, 0.09), (4.4, 3.0, 0.04), coral, collections["FURNITURE"], 0.18)
    add_box("WRITERS_TABLE", (-3.7, 1.9, 0.76), (3.4, 1.35, 0.15), mats["oak_light"], collections["FURNITURE"], 0.24)
    for index, (x, y, angle) in enumerate(((-4.7, 0.85, 0), (-2.7, 0.85, 0), (-4.7, 2.95, math.pi), (-2.7, 2.95, math.pi))):
        add_chair(f"WRITER_CHAIR_{index}", (x, y), angle, mats, collections["FURNITURE"])
    add_box("STORY_BOARD", (-6.75, 5.65, 1.65), (2.0, 0.10, 1.55), mats["paper"], collections["FURNITURE"], 0.08)
    for row in range(3):
        for col in range(4):
            card_mat = coral if (row + col) % 3 == 0 else mats["paper"] if (row + col) % 2 else lavender
            add_box(f"STORY_CARD_{row}_{col}", (-7.35 + col * 0.40, 5.57, 2.08 - row * 0.43), (0.28, 0.018, 0.22), card_mat, collections["DECOR"], 0.02)

    # Editing bay divider and screening lounge.
    add_box("EDITING_DIVIDER", (2.6, -1.1, 1.35), (0.10, 3.0, 2.5), mats["charcoal"], collections["FURNITURE"], 0.04)
    for z in (0.55, 1.2, 1.85):
        add_box(f"EDITING_DIVIDER_GAP_{z}", (2.55, -1.1, z), (0.03, 2.7, 0.34), blue, collections["DECOR"], 0.03)
    add_box("SCREENING_RUG", (4.4, 3.2, 0.09), (5.0, 3.7, 0.04), lavender, collections["FURNITURE"], 0.20)
    add_sofa("SCREENING_SOFA", (4.4, 4.0), math.pi, mats, coral, 3.5)
    add_wall_screen("SCREENING_WALL", (4.5, 5.62, 1.68), (3.5, 0.16, 1.82), mats, blue)
    add_cylinder("SCREENING_TABLE", (4.4, 2.65, 0.44), 0.70, 0.10, mats["oak_light"], collections["FURNITURE"], 48)
    add_cylinder("SCREENING_TABLE_BASE", (4.4, 2.65, 0.23), 0.13, 0.42, mats["charcoal"], collections["FURNITURE"], 20)
    add_cylinder("FILM_REEL_A", (6.25, 4.95, 1.15), 0.32, 0.08, mats["charcoal"], collections["DECOR"], 40, (math.pi / 2, 0, 0))
    add_cylinder("FILM_REEL_B", (6.25, 4.95, 0.72), 0.24, 0.08, coral, collections["DECOR"], 40, (math.pi / 2, 0, 0))

    add_bot("STORY", (-4.7, -2.65, 0.1), math.pi, coral, mats)
    add_bot("MOTION", (4.5, -2.65, 0.1), math.pi, blue, mats)
    add_bot("CREATIVE", (-0.2, 1.95, 0.1), 0, lavender, mats)
    for name, location in (("APPROACH_STORY", (-4.7, -1.6, 0)), ("APPROACH_MOTION", (4.5, -1.6, 0)), ("APPROACH_CREATIVE", (-0.2, 0.9, 0)), ("WAYPOINT_SCREENING", (4.3, 1.4, 0)), ("WAYPOINT_CENTER", (0, 0, 0))):
        add_empty(name, location, collections["COLLISION_AND_NAVIGATION"])
    return {
        "story": {"position": [-4.7, -2.65, 0.1], "rotation": [0, 0, math.pi], "station": "STATION_STORY", "accent": "#f1b5ae"},
        "motion": {"position": [4.5, -2.65, 0.1], "rotation": [0, 0, math.pi], "station": "STATION_MOTION", "accent": "#9dc4fb"},
        "creative": {"position": [-0.2, 1.95, 0.1], "rotation": [0, 0, 0], "station": "STATION_CREATIVE", "accent": "#d7b1f0"},
    }


def build_research(mats):
    add_shell("RESEARCH / IDEAS", mats)
    amber = material("MAT_VAULT_AMBER", (0.78, 0.63, 0.30), 0.44)
    green = material("MAT_SCOUT_GREEN", (0.30, 0.63, 0.42), 0.42)
    add_desk("SCOUT", (-4.8, -3.5), 0, mats, green, 2)
    add_desk("VAULT", (4.7, -3.5), 0, mats, amber, 2)
    add_chair("CHAIR_SCOUT", (-4.8, -2.75), math.pi, mats, collections["FURNITURE"])
    add_chair("CHAIR_VAULT", (4.7, -2.75), math.pi, mats, collections["FURNITURE"])

    # Archive wall.
    for x in (-6.9, -5.4, -3.9):
        add_box(f"ARCHIVE_UPRIGHT_{x}", (x, 5.25, 1.45), (0.10, 0.56, 2.65), mats["charcoal"], collections["FURNITURE"], 0.02)
    for level, z in enumerate((0.30, 0.82, 1.34, 1.86, 2.38, 2.90)):
        add_box(f"ARCHIVE_SHELF_{level}", (-5.4, 5.25, z), (3.1, 0.56, 0.08), mats["oak_light"], collections["FURNITURE"], 0.025)
        for index in range(8):
            card_mat = amber if index % 4 == 0 else green if index % 3 == 0 else mats["paper"]
            add_box(f"ARCHIVE_BOOK_{level}_{index}", (-6.55 + index * 0.32, 5.17, z + 0.20), (0.16, 0.28, 0.32), card_mat, collections["DECOR"], 0.015)

    # Central idea lab table with glowing research core.
    add_box("IDEA_RUG", (0, 0.7, 0.09), (6.0, 4.1, 0.04), green, collections["FURNITURE"], 0.20)
    add_box("IDEA_TABLE", (0, 0.7, 0.76), (4.2, 1.55, 0.15), mats["oak_light"], collections["FURNITURE"], 0.30)
    for x in (-1.45, 1.45):
        add_cylinder(f"IDEA_TABLE_BASE_{x}", (x, 0.7, 0.38), 0.18, 0.68, mats["charcoal"], collections["FURNITURE"], 24)
    for index, (x, y, angle) in enumerate(((-1.4, -0.45, 0), (0, -0.45, 0), (1.4, -0.45, 0), (-1.4, 1.85, math.pi), (0, 1.85, math.pi), (1.4, 1.85, math.pi))):
        add_chair(f"IDEA_CHAIR_{index}", (x, y), angle, mats, collections["FURNITURE"])
    add_sphere("IDEA_CORE", (0, 0.7, 1.18), (0.34, 0.34, 0.34), mats["glow"], collections["DECOR"])
    for radius, z in ((0.72, 1.18), (0.52, 1.42)):
        add_torus(f"IDEA_RING_{radius}", (0, 0.7, z), radius, 0.025, amber, collections["DECOR"], (math.pi / 2, 0, 0))

    # Pin board, specimen bench and glass idea pods.
    add_box("DISCOVERY_BOARD", (3.65, 5.62, 1.68), (3.8, 0.11, 1.80), mats["paper"], collections["FURNITURE"], 0.08)
    for row in range(3):
        for col in range(6):
            note = green if (row + col) % 4 == 0 else amber if (row + col) % 3 == 0 else mats["paper"]
            add_box(f"DISCOVERY_NOTE_{row}_{col}", (2.15 + col * 0.58, 5.54, 2.15 - row * 0.46), (0.38, 0.018, 0.27), note, collections["DECOR"], 0.02)
    add_box("SPECIMEN_BENCH", (5.3, 1.15, 0.78), (2.8, 0.82, 0.12), mats["oak_light"], collections["WORKSTATIONS"], 0.07)
    for i, x in enumerate((4.5, 5.3, 6.1)):
        add_cylinder(f"SPECIMEN_JAR_{i}", (x, 1.15, 1.07), 0.16, 0.42 + i * 0.05, mats["glass"], collections["DECOR"], 28)
        add_sphere(f"SPECIMEN_{i}", (x, 1.15, 1.08), (0.10, 0.10, 0.10), green if i % 2 else amber, collections["DECOR"])
    for x in (-2.8, 2.8):
        add_cylinder(f"IDEA_POD_{x}", (x, 3.35, 1.15), 0.78, 2.15, mats["glass"], collections["WINDOWS_AND_GLASS"], 48)
        add_cylinder(f"IDEA_POD_BASE_{x}", (x, 3.35, 0.11), 0.84, 0.16, mats["charcoal"], collections["FURNITURE"], 48)
        add_sphere(f"IDEA_POD_LIGHT_{x}", (x, 3.35, 1.45), (0.25, 0.25, 0.25), amber if x > 0 else green, collections["DECOR"])

    add_bot("SCOUT", (-4.8, -2.65, 0.1), math.pi, green, mats)
    add_bot("VAULT", (4.7, -2.65, 0.1), math.pi, amber, mats)
    for name, location in (("APPROACH_SCOUT", (-4.8, -1.6, 0)), ("APPROACH_VAULT", (4.7, -1.6, 0)), ("WAYPOINT_IDEA_TABLE", (0, -1.0, 0)), ("WAYPOINT_ARCHIVE", (-4.5, 3.6, 0)), ("WAYPOINT_CENTER", (0, 0, 0))):
        add_empty(name, location, collections["COLLISION_AND_NAVIGATION"])
    return {
        "scout": {"position": [-4.8, -2.65, 0.1], "rotation": [0, 0, math.pi], "station": "STATION_SCOUT", "accent": "#9bdcb2"},
        "vault": {"position": [4.7, -2.65, 0.1], "rotation": [0, 0, math.pi], "station": "STATION_VAULT", "accent": "#eedb92"},
    }


def build_mission(mats):
    add_shell("MISSION / CONTROL", mats)
    mint = material("MAT_MIGO_MINT", (0.46, 0.72, 0.63), 0.38)
    ice = material("MAT_MISSION_ICE", (0.45, 0.66, 0.78), 0.36)
    add_desk("MIGO", (0, -3.9), 0, mats, mint, 3, 3.5)
    add_chair("CHAIR_MIGO", (0, -3.05), math.pi, mats, collections["FURNITURE"])

    # Central command table.
    add_cylinder("COMMAND_RUG", (0, 0.7, 0.08), 2.75, 0.04, ice, collections["FURNITURE"], 64)
    add_cylinder("COMMAND_TABLE", (0, 0.7, 0.75), 2.05, 0.18, mats["oak_light"], collections["FURNITURE"], 64)
    add_cylinder("COMMAND_TABLE_BASE", (0, 0.7, 0.38), 0.62, 0.68, mats["charcoal"], collections["FURNITURE"], 48)
    add_cylinder("COMMAND_MAP", (0, 0.7, 0.89), 1.45, 0.035, mats["screen"], collections["DECOR"], 64)
    add_torus("COMMAND_RING_A", (0, 0.7, 1.02), 1.10, 0.035, mats["glow"], collections["DECOR"])
    add_torus("COMMAND_RING_B", (0, 0.7, 1.36), 0.78, 0.028, mint, collections["DECOR"], (math.pi / 2, 0, 0))
    add_sphere("COMMAND_ORB", (0, 0.7, 1.45), (0.26, 0.26, 0.26), mats["glow"], collections["DECOR"])
    for index, angle in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
        x = math.cos(angle) * 3.1
        y = 0.7 + math.sin(angle) * 2.25
        add_chair(f"COMMAND_CHAIR_{index}", (x, y), angle + math.pi, mats, collections["FURNITURE"])

    # Dashboard wall with six panels.
    add_box("DASHBOARD_WALL", (-1.2, 5.64, 1.74), (8.6, 0.14, 2.64), mats["charcoal"], collections["FURNITURE"], 0.08)
    panel_colors = [mint, ice, mats["accent"], mint, ice, mats["accent2"]]
    for row in range(2):
        for col in range(3):
            index = row * 3 + col
            x = -4.1 + col * 2.85
            z = 2.30 - row * 1.12
            add_box(f"DASH_PANEL_{index}", (x, 5.54, z), (2.45, 0.035, 0.88), mats["screen"], collections["DECOR"], 0.06)
            add_box(f"DASH_LINE_{index}_A", (x - 0.25, 5.51, z + 0.16), (1.35, 0.012, 0.045), panel_colors[index], collections["DECOR"], 0.012)
            add_box(f"DASH_LINE_{index}_B", (x + 0.15, 5.51, z - 0.05), (0.95, 0.012, 0.045), panel_colors[index], collections["DECOR"], 0.012)
            for bar in range(4):
                add_box(f"DASH_BAR_{index}_{bar}", (x - 0.75 + bar * 0.42, 5.50, z - 0.27), (0.18, 0.012, 0.12 + bar * 0.05), panel_colors[index], collections["DECOR"], 0.01)

    # Side consoles and briefing lounge.
    for side in (-1, 1):
        x = side * 5.15
        add_box(f"OPS_CONSOLE_{side}", (x, 0.2, 0.80), (2.2, 0.92, 0.16), mats["oak_light"], collections["WORKSTATIONS"], 0.08, (0, 0, side * math.radians(8)))
        add_monitor(f"OPS_MONITOR_{side}", (x, -0.02, 1.38), side * math.radians(8), mats, mint if side < 0 else ice, wide=True)
        add_chair(f"OPS_CHAIR_{side}", (x, -0.85), math.pi + side * math.radians(8), mats, collections["FURNITURE"])
    add_box("BRIEFING_RUG", (4.6, 3.45, 0.09), (4.4, 3.3, 0.04), mint, collections["FURNITURE"], 0.18)
    add_sofa("BRIEFING_SOFA", (4.8, 4.3), math.pi, mats, ice, 3.2)
    add_cylinder("BRIEFING_TABLE", (4.7, 2.9, 0.45), 0.68, 0.12, mats["oak_light"], collections["FURNITURE"], 48)
    add_box("MISSION_TIMELINE", (-6.65, 5.62, 1.65), (2.15, 0.11, 1.65), mats["paper"], collections["FURNITURE"], 0.08)
    for index in range(5):
        add_box(f"MISSION_CARD_{index}", (-7.3 + (index % 2) * 0.75, 5.54, 2.25 - (index // 2) * 0.52), (0.52, 0.018, 0.29), mint if index % 2 else ice, collections["DECOR"], 0.025)

    add_bot("MIGO", (0, -3.0, 0.1), math.pi, mint, mats)
    for name, location in (("APPROACH_MIGO", (0, -1.85, 0)), ("WAYPOINT_COMMAND", (0, -1.0, 0)), ("WAYPOINT_DASHBOARD", (0, 3.7, 0)), ("WAYPOINT_BRIEFING", (4.5, 1.6, 0)), ("WAYPOINT_ENTRY", (0, -5.0, 0))):
        add_empty(name, location, collections["COLLISION_AND_NAVIGATION"])
    return {
        "migo": {"position": [0, -3.0, 0.1], "rotation": [0, 0, math.pi], "station": "STATION_MIGO", "accent": "#b8eadb"},
    }


FLOORS = [
    {
        "slug": "entertainment",
        "display_name": "Entertainment",
        "file_stem": "NYONI_HQ_Entertainment_v01",
        "glb": "entertainment_floor.glb",
        "poster": "entertainment_isometric.png",
        "accent": (0.42, 0.43, 0.78),
        "accent2": (0.82, 0.42, 0.38),
        "builder": build_entertainment,
    },
    {
        "slug": "research_lab",
        "display_name": "Research Lab",
        "file_stem": "NYONI_HQ_Research_Lab_v01",
        "glb": "research_lab_floor.glb",
        "poster": "research_lab_isometric.png",
        "accent": (0.62, 0.48, 0.20),
        "accent2": (0.28, 0.56, 0.36),
        "builder": build_research,
    },
    {
        "slug": "mission_control",
        "display_name": "Mission Control",
        "file_stem": "NYONI_HQ_Mission_Control_v01",
        "glb": "mission_control_floor.glb",
        "poster": "mission_control_isometric.png",
        "accent": (0.40, 0.69, 0.59),
        "accent2": (0.42, 0.62, 0.76),
        "builder": build_mission,
    },
]


def export_static_floor(path):
    bpy.ops.object.select_all(action="DESELECT")
    excluded = {"AGENTS", "LIGHTING", "CAMERAS", "COLLISION_AND_NAVIGATION"}
    for name, collection in collections.items():
        if name in excluded:
            continue
        for obj in collection.all_objects:
            if obj.type not in {"LIGHT", "CAMERA", "EMPTY"}:
                obj.select_set(True)
    selected = list(bpy.context.selected_objects)
    if selected:
        bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=True,
    )


def waypoint_payload():
    payload = {}
    collection = collections["COLLISION_AND_NAVIGATION"]
    for obj in collection.objects:
        if obj.name.startswith(("WAYPOINT_", "APPROACH_")):
            payload[obj.name] = [round(value, 4) for value in obj.location]
    return payload


manifests = {}
for config in FLOORS:
    reset_scene()
    scene = configure_scene()
    root_collection, collections = create_collections(config["slug"])
    mats = make_palette(config["slug"].upper(), config["accent"], config["accent2"])
    agents = config["builder"](mats)
    main_camera, elevated_camera = add_camera_and_lights(config["slug"], mats)

    blend_path = os.path.join(OUT, f"{config['file_stem']}.blend")
    checkpoint_path = os.path.join(CHECKPOINT_DIR, f"{config['file_stem']}_checkpoint.blend")
    bpy.ops.wm.save_as_mainfile(filepath=checkpoint_path)

    scene.camera = main_camera
    scene.render.filepath = os.path.join(RENDER_DIR, config["poster"])
    bpy.ops.render.render(write_still=True)
    scene.camera = elevated_camera
    elevated_name = config["poster"].replace("_isometric", "_elevated")
    scene.render.filepath = os.path.join(RENDER_DIR, elevated_name)
    bpy.ops.render.render(write_still=True)
    scene.camera = main_camera

    glb_path = os.path.join(EXPORT_DIR, config["glb"])
    export_static_floor(glb_path)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    manifests[config["slug"]] = {
        "id": f"NYONI_{config['slug'].upper()}",
        "display_name": config["display_name"],
        "dimensions_m": [16.0, 12.0, 3.4],
        "glb": config["glb"],
        "poster": config["poster"],
        "agents": agents,
        "navigation": waypoint_payload(),
        "camera": {
            "position": [18.0, -20.0, 17.0],
            "target": [0.0, 0.0, 0.75],
            "ortho_scale": 23.5,
        },
    }
    print("FLOOR_OK", config["slug"], blend_path, glb_path, scene.render.filepath, len(scene.objects))

manifest_path = os.path.join(EXPORT_DIR, "remaining_floors_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as handle:
    json.dump({"schema_version": 1, "floors": manifests}, handle, indent=2)

mission_path = os.path.join(OUT, "NYONI_HQ_Mission_Control_v01.blend")
bpy.ops.wm.open_mainfile(filepath=mission_path)
print("REMAINING_FLOORS_COMPLETE", manifest_path, bpy.data.filepath)
