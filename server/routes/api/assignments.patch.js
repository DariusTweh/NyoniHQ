import { defineEventHandler, readBody } from 'nitro/h3';
import { patchAssignment } from '../../assignment-api.js';
import { requireStudioAccess } from './_auth.js';

export default defineEventHandler(async (event) => {
  requireStudioAccess(event);
  return patchAssignment(await readBody(event));
});
