import { defineEventHandler, setHeader } from 'nitro/h3';
import { beginGoogleAuthorization } from '../../../../google-tools.js';
import { requireStudioAccess } from '../../_auth.js';

export default defineEventHandler(async (event) => {
  requireStudioAccess(event);
  setHeader(event, 'Cache-Control', 'no-store');
  const authorization = await beginGoogleAuthorization();
  return { url: authorization.url, expiresAt: authorization.expiresAt || null };
});
