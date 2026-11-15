import { defineEventHandler, setHeader } from 'nitro/h3';
import { googleConnectionStatus } from '../../../google-tools.js';
import { runtimeStatus } from '../../../nyoni-runtime.js';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  return { ...runtimeStatus(), google: await googleConnectionStatus() };
});
