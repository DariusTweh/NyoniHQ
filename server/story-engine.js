import crypto from 'node:crypto';
import { z } from 'zod';

const dialogueLineSchema = z.object({
  id: z.string().min(1),
  speakerId: z.string().min(1),
  recipientId: z.string().min(1),
  text: z.string().min(1).max(240),
  emotion: z.string().min(1),
  performance: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
});

export const storyScriptPacketSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1),
  assignmentId: z.string().min(1),
  title: z.string().min(1),
  genre: z.string().min(1),
  tone: z.string().min(1),
  audience: z.string().min(1),
  logline: z.string().min(1),
  objective: z.string().min(1),
  durationSeconds: z.number().positive().max(10),
  characters: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), motivation: z.string().min(1),
    relationship: z.string().min(1), voiceDirection: z.string().min(1),
  })).length(2),
  location: z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1) }),
  beats: z.array(z.object({ id: z.string().min(1), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), action: z.string().min(1), purpose: z.enum(['setup', 'misunderstanding', 'punchline', 'reaction']) })).min(3),
  dialogue: z.array(dialogueLineSchema).min(2).max(5),
  reversals: z.array(z.string().min(1)).min(1),
  payoff: z.string().min(1),
  continuityRules: z.array(z.string().min(1)).min(1),
  canonReferences: z.array(z.string()),
  audioRequirements: z.array(z.string().min(1)).min(1),
  blockers: z.array(z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() })),
});

export function dialogueSignature(dialogue) {
  const immutable = dialogue.map(({ id, speakerId, recipientId, text }) => ({ id, speakerId, recipientId, text }));
  return crypto.createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
}

export function validateStoryScriptPacket(value) {
  const packet = storyScriptPacketSchema.parse(value);
  const characterIds = new Set(packet.characters.map((item) => item.id));
  const findings = [];
  for (const line of packet.dialogue) {
    if (!characterIds.has(line.speakerId) || !characterIds.has(line.recipientId) || line.speakerId === line.recipientId) findings.push({ code: 'INVALID_DIALOGUE_MAPPING', severity: 'blocking', lineId: line.id });
    if (line.endSeconds <= line.startSeconds || line.endSeconds > packet.durationSeconds) findings.push({ code: 'INVALID_DIALOGUE_TIMING', severity: 'blocking', lineId: line.id });
  }
  for (const beat of packet.beats) if (beat.endSeconds <= beat.startSeconds || beat.endSeconds > packet.durationSeconds) findings.push({ code: 'INVALID_BEAT_TIMING', severity: 'blocking', beatId: beat.id });
  if (!packet.beats.some((item) => item.purpose === 'setup')) findings.push({ code: 'MISSING_SETUP', severity: 'blocking' });
  if (!packet.beats.some((item) => item.purpose === 'misunderstanding')) findings.push({ code: 'MISSING_MISUNDERSTANDING', severity: 'blocking' });
  if (!packet.beats.some((item) => item.purpose === 'punchline')) findings.push({ code: 'MISSING_PUNCHLINE', severity: 'blocking' });
  if (packet.canonReferences.some((item) => /palava\s*231/i.test(item))) findings.push({ code: 'EXCLUDED_CANON', severity: 'blocking' });
  return { packet: { ...packet, dialogueSignature: dialogueSignature(packet.dialogue) }, findings, disposition: findings.length ? 'REWRITE' : 'PASS' };
}

export const storyJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion','projectId','assignmentId','title','genre','tone','audience','logline','objective','durationSeconds','characters','location','beats','dialogue','reversals','payoff','continuityRules','canonReferences','audioRequirements','blockers'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] }, projectId: { type: 'string' }, assignmentId: { type: 'string' }, title: { type: 'string' }, genre: { type: 'string' }, tone: { type: 'string' }, audience: { type: 'string' }, logline: { type: 'string' }, objective: { type: 'string' }, durationSeconds: { type: 'number', maximum: 10 },
    characters: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['id','name','motivation','relationship','voiceDirection'], properties: { id:{type:'string'}, name:{type:'string'}, motivation:{type:'string'}, relationship:{type:'string'}, voiceDirection:{type:'string'} } } },
    location: { type:'object', additionalProperties:false, required:['id','name','description'], properties:{ id:{type:'string'}, name:{type:'string'}, description:{type:'string'} } },
    beats: { type:'array', minItems:3, items:{ type:'object', additionalProperties:false, required:['id','startSeconds','endSeconds','action','purpose'], properties:{ id:{type:'string'}, startSeconds:{type:'number'}, endSeconds:{type:'number'}, action:{type:'string'}, purpose:{type:'string',enum:['setup','misunderstanding','punchline','reaction']} } } },
    dialogue: { type:'array', minItems:2, maxItems:5, items:{ type:'object', additionalProperties:false, required:['id','speakerId','recipientId','text','emotion','performance','startSeconds','endSeconds'], properties:{ id:{type:'string'}, speakerId:{type:'string'}, recipientId:{type:'string'}, text:{type:'string'}, emotion:{type:'string'}, performance:{type:'string'}, startSeconds:{type:'number'}, endSeconds:{type:'number'} } } },
    reversals:{type:'array',items:{type:'string'}}, payoff:{type:'string'}, continuityRules:{type:'array',items:{type:'string'}}, canonReferences:{type:'array',items:{type:'string'}}, audioRequirements:{type:'array',items:{type:'string'}}, blockers:{type:'array',items:{type:'object',additionalProperties:false,required:['code','message','recoverable'],properties:{code:{type:'string'},message:{type:'string'},recoverable:{type:'boolean'}}}},
  },
};

export function storyPacketToScreenplay(packet) {
  const dialogue = packet.dialogue.map((line) => {
    const speaker = packet.characters.find((item) => item.id === line.speakerId)?.name || line.speakerId;
    return `[${line.startSeconds.toFixed(1)}–${line.endSeconds.toFixed(1)}] ${speaker}: ${line.text}`;
  }).join('\n');
  return `# ${packet.title}\n\n${packet.logline}\n\n${packet.location.name.toUpperCase()} — ${packet.location.description}\n\n${dialogue}\n\nPayoff: ${packet.payoff}`;
}
