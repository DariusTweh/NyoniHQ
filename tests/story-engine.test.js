import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogueSignature, validateStoryScriptPacket } from '../server/story-engine.js';
import { classifyWorkflowIntent, mergeRequiredAgents } from '../server/workflow-intent.js';

function story() {
  return {
    schemaVersion: 1, projectId: 'p1', assignmentId: 'a1', title: 'Time Served', genre: 'comedy', tone: 'dry', audience: 'general', logline: 'A clock confession goes sideways.', objective: 'Land one visual joke.', durationSeconds: 10,
    characters: [
      { id: 'detective', name: 'Detective Vale', motivation: 'Close the case.', relationship: 'Questions the suspect.', voiceDirection: 'Measured and dry.' },
      { id: 'suspect', name: 'Milo', motivation: 'Explain himself.', relationship: 'Misreads the accusation.', voiceDirection: 'Earnest and literal.' },
    ],
    location: { id: 'room', name: 'Interrogation Room', description: 'A small concrete room.' },
    beats: [
      { id: 'b1', startSeconds: 0, endSeconds: 2, action: 'Detective points to a clock.', purpose: 'setup' },
      { id: 'b2', startSeconds: 2, endSeconds: 6, action: 'Milo misunderstands.', purpose: 'misunderstanding' },
      { id: 'b3', startSeconds: 6, endSeconds: 9, action: 'Detective lands the joke.', purpose: 'punchline' },
    ],
    dialogue: [
      { id: 'l1', speakerId: 'detective', recipientId: 'suspect', text: 'You stole the clock.', emotion: 'flat', performance: 'small pause after clock', startSeconds: 0.8, endSeconds: 2.4 },
      { id: 'l2', speakerId: 'suspect', recipientId: 'detective', text: 'No. I took my time.', emotion: 'sincere', performance: 'confused', startSeconds: 3, endSeconds: 5.1 },
    ],
    reversals: ['The denial becomes a confession.'], payoff: 'The detective realizes the wording.', continuityRules: ['Keep Vale screen-left.'], canonReferences: [], audioRequirements: ['Two distinct voices.'], blockers: [],
  };
}

test('Story validates explicit speaker-recipient timing and creates an immutable dialogue signature', () => {
  const result = validateStoryScriptPacket(story());
  assert.equal(result.disposition, 'PASS');
  assert.equal(result.packet.dialogueSignature, dialogueSignature(story().dialogue));
});

test('Story rejects excluded canon and incorrect dialogue recipients', () => {
  const value = story(); value.canonReferences = ['Palava 231']; value.dialogue[0].recipientId = 'detective';
  const result = validateStoryScriptPacket(value);
  assert.equal(result.disposition, 'REWRITE');
  assert(result.findings.some((item) => item.code === 'EXCLUDED_CANON'));
  assert(result.findings.some((item) => item.code === 'INVALID_DIALOGUE_MAPPING'));
});

test('structured narrative intent mandates Story and is not truncated by a four-agent cap', () => {
  const assignment = { workflow_kind: 'scripted_production_pipeline', request: { production: { intent: 'scripted_dialogue', requiresStory: true } } };
  const intent = classifyWorkflowIntent(assignment);
  assert.equal(intent.requiresStory, true);
  assert(intent.requiredStages.includes('story_quality_gate'));
  assert(mergeRequiredAgents({ specialists: [] }, assignment).length > 4);
});

test('technical production can explicitly skip Story', () => {
  const intent = classifyWorkflowIntent({ workflow_kind: 'scripted_production_pipeline', request: { production: { intent: 'technical', requiresStory: false } } });
  assert.equal(intent.requiresStory, false);
});
