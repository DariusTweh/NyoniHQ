import { defineEventHandler, setHeader } from 'nitro/h3';
import { listPublicActivity } from '../../nyoni-store.js';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  return { activity: await listPublicActivity() };
});
