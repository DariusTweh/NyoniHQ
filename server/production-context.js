import crypto from 'node:crypto';
import { studioClient } from './nyoni-store.js';
import { PRODUCTION_PACKET_SCHEMA_VERSION, validateProductionPacket } from './production-contracts.js';

const DEFAULT_WORKSPACE_ID = 'nyoni-studios';

function blocker(code, message, resourceType, resourceId, details = {}) {
  return { code, message, resourceType, ...(resourceId ? { resourceId } : {}), recoverable: true, details };
}

function exactById(items, id) {
  if (!id || !Array.isArray(items)) return null;
  return items.find((item) => String(item?.id) === String(id)) || null;
}

function array(value) { return Array.isArray(value) ? value : []; }

function entityScript(scene, shot) {
  const source = shot || scene || {};
  return {
    text: String(source.script || source.action || source.description || source.summary || ''),
    dialogue: array(source.dialogue || source.dialogueLines),
  };
}

function inferVoicePolicy(projectName, series, production) {
  const declared = production?.voicePolicy || series?.bible?.voicePolicy || series?.voicePolicy;
  if (/colony zero/i.test(projectName)) {
    return {
      mode: 'approved-human-master', allowAutomaticVoiceSelection: false, voiceProfileId: null,
      instructions: ['Use only approved human voice masters.', 'Do not synthesize replacement dialogue without explicit authorization.'],
    };
  }
  if (declared?.voiceProfileId) {
    return { mode: 'bound-synthetic-voice', allowAutomaticVoiceSelection: false, voiceProfileId: declared.voiceProfileId, instructions: array(declared.instructions) };
  }
  return { mode: 'none', allowAutomaticVoiceSelection: false, voiceProfileId: null, instructions: ['No voice generation is authorized until a voice policy or bound profile is selected.'] };
}

function resolveAssetUrl(asset) {
  if (typeof asset?.url === 'string' && asset.url.trim()) return asset.url.trim();
  if (typeof asset?.public_url === 'string' && asset.public_url.trim()) return asset.public_url.trim();
  return null;
}

function characterReferences(character, seriesDocument) {
  const candidates = [
    ...(character?.image ? [{ id: `${character.id}-primary`, url: character.image, label: `${character.name} primary identity`, role: 'character_master', priority: 'critical' }] : []),
    ...array(character?.references).map((url, index) => ({ id: `${character.id}-reference-${index + 1}`, url, label: `${character.name} reference ${index + 1}`, role: character?.image || index ? 'character_supporting' : 'character_master', priority: character?.image || index ? 'high' : 'critical' })),
    ...array(character?.referencePack).map((entry, index) => ({ id: entry.id || `${character.id}-pack-${index + 1}`, url: entry.url, label: `${character.name} ${entry.label || entry.role || `reference ${index + 1}`}`, role: entry.role === 'wardrobe' ? 'character_look' : index ? 'character_supporting' : 'character_master', priority: entry.priority || (index ? 'high' : 'critical') })),
  ];
  const seen = new Set();
  return candidates.filter((item) => typeof item.url === 'string' && item.url && !seen.has(item.url) && seen.add(item.url)).map((item) => ({
    ...item, characterId: character.id, sourceId: character.id,
    provenance: { source: 'studio_documents.series.characters', documentId: seriesDocument.id, documentRevision: Number(seriesDocument.revision || 0) },
  }));
}

function deriveGeneration(input, project, scene, shot) {
  const overrides = { ...(project?.production_plan?.generation || {}), ...(scene?.generation || {}), ...(shot?.generation || {}), ...(input.generation || {}) };
  const entertainment = !/commercial|social|campaign/i.test(`${project?.name || ''} ${project?.production_mode || ''}`);
  return {
    mode: overrides.mode || 'text-to-video',
    provider: overrides.provider || 'kie',
    model: overrides.model || 'bytedance/seedance-2-5',
    durationSeconds: Number(overrides.durationSeconds || overrides.duration || 5),
    resolution: overrides.resolution || '720p',
    aspectRatio: overrides.aspectRatio || (entertainment ? '16:9' : '9:16'),
    generateAudio: Boolean(overrides.generateAudio),
    returnLastFrame: overrides.returnLastFrame !== false,
  };
}

function expectedDeliverables(input) {
  if (Array.isArray(input.expectedDeliverables) && input.expectedDeliverables.length) return input.expectedDeliverables;
  return [{ id: 'final-video', type: 'video', required: true, playable: true, label: 'Playable final video' }, { id: 'review-package', type: 'review_package', required: true, playable: false, label: 'Founder review package' }];
}

export function resolveProductionContextFromSnapshot(snapshot, input) {
  const { assignment, project, projectContexts = [], seriesDocuments = [], productionDocuments = [], assets = [] } = snapshot;
  if (!assignment || !project) throw new Error('Production context requires an assignment and project snapshot.');
  if (String(project.user_id) !== String(assignment.owner_id) || String(project.id) !== String(assignment.project_id)) {
    throw new Error('Production context ownership check failed.');
  }

  const blockers = [];
  const mapping = projectContexts.find((row) => row.context_type === 'series_mapping' && row.metadata?.series_document_id);
  const seriesId = input.seriesDocumentId || mapping?.metadata?.series_document_id || null;
  if (input.seriesDocumentId && mapping?.metadata?.series_document_id && input.seriesDocumentId !== mapping.metadata.series_document_id) {
    blockers.push(blocker('SERIES_MAPPING_MISMATCH', 'The requested series is not the series explicitly mapped to this HQ project.', 'series', input.seriesDocumentId, { mappedSeriesId: mapping.metadata.series_document_id }));
  }
  const seriesDocument = seriesId ? seriesDocuments.find((row) => row.id === seriesId && String(row.user_id) === String(assignment.owner_id)) || null : null;
  if (!seriesId && input.requiresSeries !== false) blockers.push(blocker('SERIES_MAPPING_REQUIRED', 'This project needs an explicit series_document_id mapping before canon can be loaded.', 'series'));
  else if (!seriesDocument) blockers.push(blocker('SERIES_NOT_FOUND', 'The explicitly mapped series document was not found for this owner.', 'series', seriesId));

  const productionId = input.productionDocumentId || null;
  const productionDocument = productionId ? productionDocuments.find((row) => row.id === productionId && String(row.user_id) === String(assignment.owner_id)) || null : null;
  if (productionId && !productionDocument) blockers.push(blocker('PRODUCTION_NOT_FOUND', 'The requested production document was not found for this owner.', 'production', productionId));

  const series = seriesDocument?.document || null;
  const production = productionDocument?.document || null;
  const episode = exactById(series?.episodes, input.episodeId);
  if (input.episodeId && !episode) blockers.push(blocker('EPISODE_NOT_FOUND', 'The requested episode ID is not present in the mapped series.', 'episode', input.episodeId));
  const scenes = [...array(series?.scenes), ...array(episode?.scenes), ...array(production?.plan?.scenes), ...array(production?.scenes)];
  const scene = exactById(scenes, input.sceneId);
  if (input.sceneId && !scene) blockers.push(blocker('SCENE_NOT_FOUND', 'The requested scene ID is not present in the selected series or production.', 'scene', input.sceneId));
  const shot = exactById([...(array(scene?.shots)), ...(array(production?.plan?.shots))], input.shotId);
  if (input.shotId && !shot) blockers.push(blocker('SHOT_NOT_FOUND', 'The requested shot ID is not present in the selected scene or production.', 'shot', input.shotId));

  const characterIds = [...new Set(array(input.characterIds || shot?.characterIds || scene?.characterIds).map(String))];
  const characters = characterIds.map((id) => exactById(series?.characters, id)).filter(Boolean);
  for (const id of characterIds) if (!characters.some((item) => String(item.id) === id)) blockers.push(blocker('CHARACTER_NOT_FOUND', 'A required character ID is missing from the mapped series.', 'character', id));
  const references = characters.flatMap((character) => characterReferences(character, seriesDocument));
  for (const character of characters) if (!references.some((item) => item.characterId === character.id && item.role === 'character_master')) blockers.push(blocker('CHARACTER_IMAGE_MISSING', 'A required character has no approved identity image.', 'character', character.id));

  const requestedAssetIds = [...new Set(array(input.assetIds).map(String))];
  for (const assetId of requestedAssetIds) {
    const asset = assets.find((row) => String(row.id) === assetId && String(row.user_id) === String(assignment.owner_id) && String(row.project_id) === String(project.id));
    if (!asset) { blockers.push(blocker('ASSET_NOT_FOUND_OR_FORBIDDEN', 'The requested asset is missing or belongs to another project.', 'asset', assetId)); continue; }
    const url = resolveAssetUrl(asset);
    if (!url) { blockers.push(blocker('ASSET_URL_MISSING', 'The requested asset has no resolvable media URL.', 'asset', assetId)); continue; }
    references.push({ id: `asset-${asset.id}`, assetId: asset.id, sourceId: asset.id, url, role: asset.metadata?.referenceRole || 'scene_reference', priority: asset.metadata?.referencePriority || 'medium', label: asset.metadata?.label || `Project asset ${asset.id}`, provenance: { source: 'assets', documentId: asset.id } });
  }

  const generation = deriveGeneration(input, project, scene, shot);
  const packet = {
    schemaVersion: PRODUCTION_PACKET_SCHEMA_VERSION,
    packetId: input.packetId || crypto.randomUUID(), packetVersion: Number(input.packetVersion || 1), createdAt: input.createdAt || new Date().toISOString(),
    workspaceId: input.workspaceId || DEFAULT_WORKSPACE_ID, ownerId: assignment.owner_id, assignmentId: assignment.id,
    project: { id: project.id, name: project.name, productionMode: project.production_mode || null },
    series: seriesDocument ? { id: seriesDocument.id, revision: Number(seriesDocument.revision || 0) } : null,
    productionDocument: productionDocument ? { id: productionDocument.id, revision: Number(productionDocument.revision || 0) } : null,
    episodeId: input.episodeId || null, sceneId: input.sceneId || null, shotId: input.shotId || null,
    script: input.scriptText || input.dialogue ? { text: String(input.scriptText || ''), dialogue: array(input.dialogue) } : entityScript(scene, shot),
    characters: characters.map((character) => ({ id: character.id, name: character.name, versionId: character.versionId || null, canonState: character.canonState ?? null, voiceDirection: character.voiceDirection || null })),
    references, locations: array(scene?.locations || (scene?.location ? [scene.location] : [])), props: array(scene?.props || shot?.props),
    continuityRules: array(input.continuityRules || shot?.continuityRules || scene?.continuityRules || production?.plan?.continuityRules || series?.bible?.continuityRules).map(String),
    cameraDirection: input.cameraDirection || shot?.camera || scene?.camera || scene?.shotMetadata || {}, visualDirection: input.visualDirection || shot?.visualDirection || scene?.visualDirection || series?.bible?.visualDirection || {},
    voicePolicy: inferVoicePolicy(project.name, series, production), generation,
    motionPrompt: String(input.motionPrompt || ''),
    budget: { estimatedUsd: Number(input.estimatedUsd || 0), approvedLimitUsd: Number(input.approvedLimitUsd || 0), currency: 'USD' },
    expectedDeliverables: expectedDeliverables(input),
    sourceVersions: [
      ...(seriesDocument ? [{ source: 'studio_documents.series', id: seriesDocument.id, revision: Number(seriesDocument.revision || 0) }] : []),
      ...(productionDocument ? [{ source: 'studio_documents.production', id: productionDocument.id, revision: Number(productionDocument.revision || 0) }] : []),
      ...projectContexts.map((row) => ({ source: `nyoni_project_context.${row.context_type}`, id: row.id || row.title, revision: row.metadata?.memory_version || row.updated_at || 'current' })),
    ],
    blockers,
  };
  return validateProductionPacket(packet);
}

export async function resolveProductionContext(assignment, input = {}, { client = studioClient() } = {}) {
  if (!client) throw new Error('Supabase studio storage is not configured.');
  const [{ data: project, error: projectError }, { data: projectContexts, error: contextError }] = await Promise.all([
    client.from('projects').select('id,user_id,name,production_mode,production_plan').eq('id', assignment.project_id).eq('user_id', assignment.owner_id).single(),
    client.from('nyoni_project_context').select('id,context_type,title,metadata,updated_at').eq('project_id', assignment.project_id).eq('owner_id', assignment.owner_id),
  ]);
  if (projectError) throw new Error(`Production project lookup failed: ${projectError.message}`);
  if (contextError) throw new Error(`Production context mapping lookup failed: ${contextError.message}`);
  const mapping = (projectContexts || []).find((row) => row.context_type === 'series_mapping');
  const seriesId = input.seriesDocumentId || mapping?.metadata?.series_document_id || null;
  const productionId = input.productionDocumentId || null;
  const documentIds = [seriesId, productionId].filter(Boolean);
  const { data: documents, error: documentsError } = documentIds.length
    ? await client.from('studio_documents').select('user_id,kind,id,document,revision,updated_at').eq('user_id', assignment.owner_id).in('id', documentIds)
    : { data: [], error: null };
  if (documentsError) throw new Error(`Movie Studio document lookup failed: ${documentsError.message}`);
  const assetIds = [...new Set(array(input.assetIds).map(String))];
  const { data: assets, error: assetsError } = assetIds.length
    ? await client.from('assets').select('id,user_id,project_id,type,url,storage_path,metadata').eq('user_id', assignment.owner_id).in('id', assetIds)
    : { data: [], error: null };
  if (assetsError) throw new Error(`Production asset lookup failed: ${assetsError.message}`);
  return resolveProductionContextFromSnapshot({
    assignment, project, projectContexts: projectContexts || [],
    seriesDocuments: (documents || []).filter((row) => row.kind === 'series'),
    productionDocuments: (documents || []).filter((row) => row.kind === 'production'), assets: assets || [],
  }, input);
}

export async function persistProductionPacket(packet, { client = studioClient() } = {}) {
  const validated = validateProductionPacket(packet);
  const { data, error } = await client.from('nyoni_production_packets').insert({
    owner_id: validated.ownerId, workspace_id: validated.workspaceId, project_id: validated.project.id,
    assignment_id: validated.assignmentId, series_document_id: validated.series?.id || null,
    production_document_id: validated.productionDocument?.id || null, episode_id: validated.episodeId,
    scene_id: validated.sceneId, shot_id: validated.shotId, schema_version: validated.schemaVersion,
    packet_version: validated.packetVersion, status: validated.blockers.length ? 'blocked' : 'ready',
    packet: validated, blockers: validated.blockers, source_versions: validated.sourceVersions,
  }).select('*').single();
  if (error) throw new Error(`Production packet persistence failed: ${error.message}`);
  return data;
}

