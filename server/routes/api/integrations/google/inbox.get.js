import { defineEventHandler, getQuery, setHeader } from 'nitro/h3';
import { getRecentInbox } from '../../../../google-tools.js';
import { requireStudioAccess } from '../../_auth.js';

export default defineEventHandler(async (event) => {
  requireStudioAccess(event);
  setHeader(event, 'Cache-Control', 'no-store');
  const query = getQuery(event);
  const messages = await getRecentInbox({ maxResults: query.limit || 8 });
  return { messages };
});
