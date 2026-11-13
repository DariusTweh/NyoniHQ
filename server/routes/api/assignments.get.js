import { defineEventHandler } from 'nitro/h3';
import { getAssignments } from '../../assignment-api.js';
import { requireStudioAccess } from './_auth.js';

export default defineEventHandler(async (event) => {
  requireStudioAccess(event);
  return getAssignments();
});
