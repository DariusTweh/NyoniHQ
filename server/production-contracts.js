import { z } from 'zod';

export const PRODUCTION_PACKET_SCHEMA_VERSION = 1;

export const productionBlockerSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().optional(),
  recoverable: z.boolean().default(true),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const productionReferenceSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().optional(),
  sourceId: z.string().optional(),
  url: z.string().min(1),
  role: z.enum([
    'character_master', 'character_supporting', 'character_look', 'location_master',
    'background_plate', 'camera_setup', 'stage_geography', 'prop', 'previous_frame',
    'scene_reference', 'product_master', 'style_reference',
  ]),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  label: z.string().min(1),
  characterId: z.string().optional(),
  versionId: z.string().optional(),
  provenance: z.object({
    source: z.string().min(1),
    documentId: z.string().optional(),
    documentRevision: z.number().int().nonnegative().optional(),
  }),
});

export const generationConfigSchema = z.object({
  mode: z.enum(['text-to-video', 'reference-to-video', 'image-to-video', 'video-edit', 'text-to-image', 'image-to-image', 'voice', 'music']),
  provider: z.enum(['kie', 'wavespeed', 'elevenlabs', 'openai']),
  model: z.string().min(1),
  durationSeconds: z.number().positive().max(600),
  resolution: z.enum(['480p', '540p', '720p', '768p', '1080p', '2k', '2K', '4K', '1K']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']),
  generateAudio: z.boolean().default(false),
  returnLastFrame: z.boolean().default(true),
});

export const expectedDeliverableSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['video', 'image', 'audio', 'script', 'caption', 'review_package']),
  required: z.boolean().default(true),
  playable: z.boolean().default(false),
  label: z.string().min(1),
});

export const sceneProductionPacketSchema = z.object({
  schemaVersion: z.literal(PRODUCTION_PACKET_SCHEMA_VERSION),
  packetId: z.string().uuid(),
  packetVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  workspaceId: z.string().min(1),
  ownerId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  project: z.object({ id: z.string().uuid(), name: z.string().min(1), productionMode: z.string().nullable() }),
  series: z.object({ id: z.string(), revision: z.number().int().nonnegative() }).nullable(),
  productionDocument: z.object({ id: z.string(), revision: z.number().int().nonnegative() }).nullable(),
  episodeId: z.string().nullable(),
  sceneId: z.string().nullable(),
  shotId: z.string().nullable(),
  script: z.object({ text: z.string(), dialogue: z.array(z.unknown()) }),
  characters: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), versionId: z.string().nullable(),
    canonState: z.unknown().nullable(), voiceDirection: z.string().nullable(),
  })),
  references: z.array(productionReferenceSchema),
  locations: z.array(z.unknown()),
  props: z.array(z.unknown()),
  continuityRules: z.array(z.string()),
  cameraDirection: z.record(z.string(), z.unknown()),
  visualDirection: z.record(z.string(), z.unknown()),
  voicePolicy: z.object({
    mode: z.enum(['none', 'approved-human-master', 'bound-synthetic-voice', 'original-narration', 'music-only']),
    allowAutomaticVoiceSelection: z.literal(false),
    voiceProfileId: z.string().nullable(),
    instructions: z.array(z.string()),
  }),
  generation: generationConfigSchema,
  motionPrompt: z.string(),
  directingPhase: z.enum(['preliminary', 'final']).default('final'),
  frameRateIntent: z.string().default('24fps cinematic motion unless the project specifies otherwise'),
  stageGeography: z.record(z.string(), z.unknown()).default({}),
  eyelines: z.array(z.unknown()).default([]),
  actionTimeline: z.array(z.unknown()).default([]),
  endState: z.record(z.string(), z.unknown()).default({}),
  negativeConstraints: z.array(z.string()).default([]),
  audioReferences: z.array(z.object({
    id: z.string().min(1), assetId: z.string().optional(), url: z.string().min(1),
    role: z.enum(['dialogue', 'music', 'ambience', 'sound_effect']),
    label: z.string().min(1), durationSeconds: z.number().positive().max(3600).nullable(),
    characterId: z.string().optional(), preservation: z.enum(['reference_guidance', 'exact_master']).default('reference_guidance'),
  })).default([]),
  audioStrategy: z.object({
    mode: z.enum(['none', 'provider_generated', 'reference_guided', 'exact_post_mix']).default('none'),
    exactMastersRequired: z.boolean().default(false), instructions: z.array(z.string()).default([]),
  }).default({ mode: 'none', exactMastersRequired: false, instructions: [] }),
  budget: z.object({ estimatedUsd: z.number().nonnegative(), approvedLimitUsd: z.number().nonnegative(), currency: z.literal('USD') }),
  expectedDeliverables: z.array(expectedDeliverableSchema).min(1),
  sourceVersions: z.array(z.object({ source: z.string(), id: z.string(), revision: z.union([z.string(), z.number()]) })),
  blockers: z.array(productionBlockerSchema),
});

export function validateProductionPacket(value) {
  return sceneProductionPacketSchema.parse(value);
}

export const PRODUCTION_STATES = Object.freeze([
  'creative_planning', 'waiting_generation', 'media_generating', 'media_blocked',
  'needs_qa_repair', 'ready_finishing', 'ready_founder_review', 'approved_release_slate',
  'changes_requested', 'rejected', 'failed',
]);

export function requiredMediaState(packet, media = []) {
  const required = packet.expectedDeliverables.filter((item) => item.required && ['video', 'image', 'audio'].includes(item.type));
  const satisfied = new Set(media.filter((item) => item?.url && (!item.playableRequired || item.playable !== false)).map((item) => item.type));
  const missing = required.filter((item) => !satisfied.has(item.type));
  return { complete: missing.length === 0, missing };
}

