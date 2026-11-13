import { defineEventHandler, readBody, setResponseStatus } from 'nitro/h3';
import { postAssignment } from '../../assignment-api.js';
import { requireStudioAccess } from './_auth.js';

export default defineEventHandler(async (event) => {
  requireStudioAccess(event);
  const result = await postAssignment(await readBody(event));
  setResponseStatus(event, 202);
  return result;
});
