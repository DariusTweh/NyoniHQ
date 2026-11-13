import { createError, getHeader } from 'nitro/h3';
import { verifyAccess } from '../../nyoni-runtime.js';

export function requireStudioAccess(event) {
  if (!verifyAccess(getHeader(event, 'x-nyoni-access-token'))) {
    throw createError({ statusCode: 401, statusMessage: 'Studio passcode is required.' });
  }
}
