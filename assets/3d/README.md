# Nyoni HQ 3D Floors

Load a floor GLB and the shared `nyoni_bot.glb` with `useGLTF` from `@react-three/drei`. `nyoni_hq_manifest.json` contains stable floor, agent, station, camera, color, and clip data.

Available floor assets:

- `commercials_floor.glb`
- `entertainment_floor.glb`
- `research_lab_floor.glb`
- `mission_control_floor.glb`

## Runtime guidance

- Units are meters; keep the exported scene at scale 1.
- Use ACES tone mapping, a warm directional key, a cool hemisphere fill, and contact shadows.
- Select a room from `manifest.floors`, create one bot instance per floor agent, and swap the accent material by agent ID.
- Map task states to clips: idle → `idle_loop`, active desk work → `typing_loop`, moving → `walk_loop`, review → `approval_alert_loop`, completed → `celebrate_once`, speaking → `talking_loop`.
- Use the station and approach transforms for selection, camera zoom, and future navigation.
- Keep actual progress in the application backend; the GLBs contain presentation and animation only.

## React Three Fiber sketch

```tsx
const floor = useGLTF(`/assets/3d/${manifest.floors[floorSlug].glb}`)
const bot = useGLTF('/assets/3d/nyoni_bot.glb')
return <><primitive object={floor.scene} /><primitive object={bot.scene.clone()} /></>
```
