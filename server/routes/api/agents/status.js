import { defineEventHandler, setHeader } from 'nitro/h3';
import { runtimeStatus } from '../../../nyoni-runtime.js';

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store');
  return runtimeStatus();
});
