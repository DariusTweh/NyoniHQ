import bpy
import json
import math
import os


OUT = "/Users/dariustweh/Downloads/nyoni-hq-starter/blender_output"
EXPORT_DIR = os.path.join(OUT, "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)

CLIP_NAMES = [
    "idle_loop",
    "walk_loop",
    "typing_loop",
    "thinking_loop",
    "celebrate_once",
    "approval_alert_loop",
    "talking_loop",
]


def remove_old_actions():
    bot = bpy.data.objects.get("AGENT_SCOUT")
    if bot and bot.animation_data:
        bot.animation_data.action = None
        for track in list(bot.animation_data.nla_tracks):
            bot.animation_data.nla_tracks.remove(track)
    for name in CLIP_NAMES:
        action = bpy.data.actions.get(name)
        if action:
            bpy.data.actions.remove(action)


def make_root_action(obj, name, keyframes, loop=True):
    action = bpy.data.actions.new(name)
    action["loop"] = loop
    action["web_clip"] = True
    obj.animation_data_create()
    obj.animation_data.action = action
    base_location = obj.location.copy()
    base_rotation = obj.rotation_euler.copy()
    base_scale = obj.scale.copy()
    for frame, location_offset, rotation_offset, scale_multiplier in keyframes:
        obj.location = (
            base_location.x + location_offset[0],
            base_location.y + location_offset[1],
            base_location.z + location_offset[2],
        )
        obj.rotation_euler = (
            base_rotation.x + rotation_offset[0],
            base_rotation.y + rotation_offset[1],
            base_rotation.z + rotation_offset[2],
        )
        obj.scale = tuple(base_scale[i] * scale_multiplier[i] for i in range(3))
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
        obj.keyframe_insert(data_path="scale", frame=frame)
    obj.animation_data.action = None
    obj.location = base_location
    obj.rotation_euler = base_rotation
    obj.scale = base_scale
    return action


remove_old_actions()
bot_root = bpy.data.objects["AGENT_SCOUT"]
bot_root.rotation_mode = "XYZ"

make_root_action(
    bot_root,
    "idle_loop",
    [
        (1, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
        (24, (0, 0, 0.035), (0, math.radians(1.2), math.radians(1.0)), (1.01, 1.01, 0.99)),
        (48, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
    ],
)


make_root_action(
    bot_root,
    "walk_loop",
    [
        (1, (0, 0, 0), (0, 0, math.radians(-3)), (1, 1, 1)),
        (8, (0, 0, 0.055), (0, 0, math.radians(3)), (1, 1, 0.98)),
        (16, (0, 0, 0), (0, 0, math.radians(-3)), (1, 1, 1)),
        (24, (0, 0, 0.055), (0, 0, math.radians(3)), (1, 1, 0.98)),
        (32, (0, 0, 0), (0, 0, math.radians(-3)), (1, 1, 1)),
    ],
)
make_root_action(
    bot_root,
    "typing_loop",
    [
        (1, (0, 0, 0), (math.radians(1.5), 0, math.radians(-1)), (1, 1, 1)),
        (6, (0, 0, 0.012), (math.radians(-1.5), 0, math.radians(1)), (1, 1, 1)),
        (12, (0, 0, 0), (math.radians(1.5), 0, math.radians(-1)), (1, 1, 1)),
        (18, (0, 0, 0.012), (math.radians(-1.5), 0, math.radians(1)), (1, 1, 1)),
        (24, (0, 0, 0), (math.radians(1.5), 0, math.radians(-1)), (1, 1, 1)),
    ],
)
make_root_action(
    bot_root,
    "thinking_loop",
    [
        (1, (0, 0, 0), (0, math.radians(-4), 0), (1, 1, 1)),
        (24, (0, 0, 0.02), (0, math.radians(6), math.radians(4)), (1, 1, 1)),
        (48, (0, 0, 0), (0, math.radians(-4), 0), (1, 1, 1)),
    ],
)
make_root_action(
    bot_root,
    "celebrate_once",
    [
        (1, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
        (10, (0, 0, 0.24), (0, 0, math.radians(-8)), (1.06, 1.06, 0.94)),
        (18, (0, 0, 0.05), (0, 0, math.radians(8)), (0.97, 0.97, 1.04)),
        (26, (0, 0, 0.16), (0, 0, math.radians(-5)), (1.03, 1.03, 0.97)),
        (36, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
    ],
    loop=False,
)
make_root_action(
    bot_root,
    "approval_alert_loop",
    [
        (1, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
        (6, (0, 0, 0.045), (0, 0, math.radians(4)), (1.04, 1.04, 0.96)),
        (12, (0, 0, 0), (0, 0, math.radians(-4)), (1, 1, 1)),
        (18, (0, 0, 0.045), (0, 0, math.radians(4)), (1.04, 1.04, 0.96)),
        (24, (0, 0, 0), (0, 0, 0), (1, 1, 1)),
    ],
)
make_root_action(
    bot_root,
    "talking_loop",
    [
        (1, (0, 0, 0), (0, math.radians(-2), math.radians(-2)), (1, 1, 1)),
        (8, (0, 0, 0.018), (0, math.radians(2), math.radians(2)), (1, 1, 1)),
        (16, (0, 0, 0), (0, math.radians(-2), math.radians(-2)), (1, 1, 1)),
        (24, (0, 0, 0.018), (0, math.radians(2), math.radians(2)), (1, 1, 1)),
        (32, (0, 0, 0), (0, math.radians(-2), math.radians(-2)), (1, 1, 1)),
    ],
)


def install_nla_clips(obj):
    """Expose every action as a separately named glTF animation clip."""
    animation_data = obj.animation_data_create()
    animation_data.action = None
    for track in list(animation_data.nla_tracks):
        animation_data.nla_tracks.remove(track)
    for name in CLIP_NAMES:
        action = bpy.data.actions[name]
        track = animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        strip.action_frame_start = action.frame_range[0]
        strip.action_frame_end = action.frame_range[1]


install_nla_clips(bot_root)


def deselect_all():
    bpy.ops.object.select_all(action="DESELECT")


def select_collection_objects(collection_names):
    deselect_all()
    selected = []
    for name in collection_names:
        collection = bpy.data.collections.get(name)
        if not collection:
            continue
        for obj in collection.all_objects:
            if obj.name.startswith("CAM_") or obj.type in {"CAMERA", "LIGHT"}:
                continue
            obj.select_set(True)
            selected.append(obj)
    if selected:
        bpy.context.view_layer.objects.active = selected[0]
    return selected


floor_objects = select_collection_objects(
    [
        "ARCHITECTURE",
        "WINDOWS_AND_GLASS",
        "FURNITURE",
        "WORKSTATIONS",
        "DECOR",
        "COLLISION_AND_NAVIGATION",
    ]
)
floor_path = os.path.join(EXPORT_DIR, "commercials_floor.glb")
bpy.ops.export_scene.gltf(
    filepath=floor_path,
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_apply=True,
)

deselect_all()
bot_selection = [bot_root] + list(bot_root.children_recursive)
for obj in bot_selection:
    obj.select_set(True)
bpy.context.view_layer.objects.active = bot_root
bot_path = os.path.join(EXPORT_DIR, "nyoni_bot.glb")
bpy.ops.export_scene.gltf(
    filepath=bot_path,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_merge_animation="NLA_TRACK",
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_apply=False,
    export_force_sampling=True,
)


def transform_payload(obj):
    return {
        "position": [round(value, 4) for value in obj.location],
        "rotation_euler_xyz": [round(value, 5) for value in obj.rotation_euler],
        "scale": [round(value, 4) for value in obj.scale],
    }


agents = {}
for agent_id in ["SCOUT", "CREATIVE", "PULSE", "HUNTER"]:
    obj = bpy.data.objects[f"AGENT_{agent_id}"]
    agents[f"AGENT_{agent_id}"] = {
        **transform_payload(obj),
        "station_id": f"STATION_{agent_id}",
        "accent_material": f"MAT_{agent_id}_" + ("GREEN" if agent_id == "SCOUT" else "LAVENDER" if agent_id == "CREATIVE" else "BLUE" if agent_id == "PULSE" else "AMBER"),
    }

stations = {
    name: transform_payload(obj)
    for name, obj in bpy.data.objects.items()
    if name.startswith("STATION_")
}
waypoints = {
    name: transform_payload(obj)
    for name, obj in bpy.data.objects.items()
    if name.startswith("WAYPOINT_") or name.startswith("APPROACH_")
}
main_camera = bpy.data.objects["CAM_MAIN_ISO"]
elevated_camera = bpy.data.objects["CAM_ELEVATED"]
manifest = {
    "schema_version": 1,
    "asset_units": "meters",
    "floor": {
        "id": "NYONI_COMMERCIALS",
        "dimensions_m": [16.0, 12.0, 3.4],
        "glb": "commercials_floor.glb",
    },
    "bot_asset": {
        "glb": "nyoni_bot.glb",
        "base_agent": "AGENT_SCOUT",
        "animation_clips": CLIP_NAMES,
        "looping_clips": [name for name in CLIP_NAMES if name != "celebrate_once"],
    },
    "agents": agents,
    "stations": stations,
    "navigation": waypoints,
    "cameras": {
        "main": {
            **transform_payload(main_camera),
            "type": "orthographic",
            "ortho_scale": main_camera.data.ortho_scale,
        },
        "elevated": {
            **transform_payload(elevated_camera),
            "type": "orthographic",
            "ortho_scale": elevated_camera.data.ortho_scale,
        },
    },
    "material_variants": {
        "SCOUT": "#72B581",
        "CREATIVE": "#A378CF",
        "PULSE": "#689AC7",
        "HUNTER": "#D88436",
    },
    "web_lighting": {
        "recommended": "one warm directional light, one cool hemisphere fill, contact shadows, ACES tone mapping",
        "environment_note": "Blender area lights are not embedded as the intended final realtime lighting rig.",
    },
}

manifest_path = os.path.join(EXPORT_DIR, "nyoni_hq_manifest.json")
with open(manifest_path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)

readme_path = os.path.join(EXPORT_DIR, "README.md")
with open(readme_path, "w", encoding="utf-8") as handle:
    handle.write(
        "# Nyoni HQ Commercials Floor\n\n"
        "Load `commercials_floor.glb` and `nyoni_bot.glb` with `useGLTF` from `@react-three/drei`. "
        "The manifest contains stable agent/station IDs, transforms, waypoints, camera defaults, colors, and clip names.\n\n"
        "## Runtime guidance\n\n"
        "- Units are meters; keep the exported scene at scale 1.\n"
        "- Use ACES tone mapping, a warm directional key, a cool hemisphere fill, and contact shadows.\n"
        "- Create one bot instance per manifest agent and swap the accent material by agent ID.\n"
        "- Map task states to clips: idle → `idle_loop`, active desk work → `typing_loop`, moving → `walk_loop`, "
        "review → `approval_alert_loop`, completed → `celebrate_once`, speaking → `talking_loop`.\n"
        "- Use the station and approach transforms for selection, camera zoom, and future navigation.\n"
        "- Keep actual progress in the application backend; the GLBs contain presentation and animation only.\n\n"
        "## React Three Fiber sketch\n\n"
        "```tsx\n"
        "const floor = useGLTF('/assets/3d/commercials_floor.glb')\n"
        "const bot = useGLTF('/assets/3d/nyoni_bot.glb')\n"
        "return <><primitive object={floor.scene} /><primitive object={bot.scene.clone()} /></>\n"
        "```\n"
    )

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "NYONI_HQ_Commercials_v01.blend"))
print("EXPORT_OK", floor_path, bot_path, manifest_path, readme_path)
