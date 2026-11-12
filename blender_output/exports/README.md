# Nyoni HQ Commercials Floor

Load `commercials_floor.glb` and `nyoni_bot.glb` with `useGLTF` from `@react-three/drei`. The manifest contains stable agent/station IDs, transforms, waypoints, camera defaults, colors, and clip names.

## Runtime guidance

- Units are meters; keep the exported scene at scale 1.
- Use ACES tone mapping, a warm directional key, a cool hemisphere fill, and contact shadows.
- Create one bot instance per manifest agent and swap the accent material by agent ID.
- Map task states to clips: idle → `idle_loop`, active desk work → `typing_loop`, moving → `walk_loop`, review → `approval_alert_loop`, completed → `celebrate_once`, speaking → `talking_loop`.
- Use the station and approach transforms for selection, camera zoom, and future navigation.
- Keep actual progress in the application backend; the GLBs contain presentation and animation only.

## React Three Fiber sketch

```tsx
const floor = useGLTF('/assets/3d/commercials_floor.glb')
const bot = useGLTF('/assets/3d/nyoni_bot.glb')
return <><primitive object={floor.scene} /><primitive object={bot.scene.clone()} /></>
```
