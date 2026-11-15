const ACTOR_LIBRARY_PATH = '/api/production/library?kind=actor';

function actorId(actor) { return String(actor?.id || actor?.actorId || ''); }

export async function getGlobalActorById(actorIdValue, {
  baseUrl = process.env.NYONI_STUDIO_URL,
  serviceToken = process.env.NYONI_STUDIO_SERVICE_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const requestedId = String(actorIdValue || '').trim();
  if (!requestedId) throw new Error('A stable global actor ID is required.');
  if (!baseUrl) throw new Error('NYONI_STUDIO_URL is required for the read-only Movie Studio actor-library adapter.');
  const endpoint = new URL(ACTOR_LIBRARY_PATH, baseUrl);
  const response = await fetchImpl(endpoint, {
    headers: { Accept: 'application/json', ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}) },
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Movie Studio actor-library lookup failed with HTTP ${response.status}.`);
  const body = await response.json().catch(() => null);
  const raw = Array.isArray(body) ? body
    : Array.isArray(body?.result) ? body.result
      : Array.isArray(body?.actors) ? body.actors
        : Array.isArray(body?.items) ? body.items : [];
  const actors = raw.map((item) => item?.document || item).filter(Boolean);
  const actor = actors.find((candidate) => actorId(candidate) === requestedId);
  if (!actor) throw new Error(`Global actor ${requestedId} was not found in the Movie Studio library.`);
  return actor;
}

export function globalActorReferences(actor) {
  const urls = [
    ...(Array.isArray(actor?.references) ? actor.references : []),
    ...(Array.isArray(actor?.referencePack) ? actor.referencePack.map((item) => item?.url) : []),
    ...Object.values(actor?.referenceImages || {}),
  ].filter((url) => typeof url === 'string' && url.length > 0);
  return [...new Set(urls)];
}

