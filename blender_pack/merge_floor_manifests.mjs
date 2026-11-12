import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/dariustweh/Downloads/nyoni-hq-starter';
const exportDir = path.join(root, 'blender_output', 'exports');
const assetDir = path.join(root, 'assets', '3d');
const basePath = path.join(exportDir, 'nyoni_hq_manifest.json');
const remainingPath = path.join(exportDir, 'remaining_floors_manifest.json');

const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const remaining = JSON.parse(fs.readFileSync(remainingPath, 'utf8'));
const commercialAccents = {
  scout: '#79c98f',
  creative: '#b68de0',
  pulse: '#69aee8',
  hunter: '#e49a55',
};

const commercialAgents = Object.fromEntries(
  Object.entries(base.agents).map(([key, value]) => {
    const id = key.replace('AGENT_', '').toLowerCase();
    return [id, {
      position: value.position,
      rotation: value.rotation_euler_xyz,
      station: value.station_id,
      accent: commercialAccents[id],
    }];
  }),
);

const manifest = {
  schema_version: 2,
  asset_units: 'meters',
  bot_asset: base.bot_asset,
  floors: {
    commercials: {
      id: base.floor.id,
      display_name: 'Commercials',
      dimensions_m: base.floor.dimensions_m,
      glb: base.floor.glb,
      poster: 'commercials_poster.png',
      agents: commercialAgents,
      navigation: base.navigation,
      camera: {
        position: base.cameras.main.position,
        target: [0, 0, 0.75],
        ortho_scale: base.cameras.main.ortho_scale,
      },
    },
    ...remaining.floors,
  },
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
fs.writeFileSync(basePath, serialized);
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'nyoni_hq_manifest.json'), serialized);
console.log(JSON.stringify({ manifest: basePath, floors: Object.keys(manifest.floors) }));
