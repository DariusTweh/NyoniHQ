function lines(values) { return (Array.isArray(values) ? values : []).filter(Boolean).map(String); }

function referenceInstructions(references) {
  return references.map((reference, index) => {
    const token = `<Picture ${index + 1}>`;
    const preserve = reference.role.startsWith('character_')
      ? 'identity, face, body proportions, skin tone, hair and approved wardrobe only'
      : reference.role === 'location_master' || reference.role === 'background_plate'
        ? 'environment geography, architecture, materials and lighting anchors only'
        : reference.role === 'prop' || reference.role === 'product_master'
          ? 'object identity, proportions, markings and material finish only'
          : 'the explicitly assigned visual dimension only';
    return `${token} — ${reference.label}: preserve ${preserve}. Do not import unrelated action, wardrobe, characters, text or story facts from this image.`;
  });
}

function timedBeats(packet) {
  const duration = packet.generation.durationSeconds;
  const dialogue = packet.script.dialogue;
  if (dialogue.length) {
    const slice = duration / Math.max(dialogue.length, 1);
    return dialogue.map((line, index) => {
      const start = (index * slice).toFixed(1);
      const end = Math.min(duration, (index + 1) * slice).toFixed(1);
      const speaker = line?.speaker || line?.character || 'Character';
      const text = line?.text || line?.line || String(line);
      return `[${start}s–${end}s] ${speaker} performs the visible action and authorized line: “${text}”`;
    });
  }
  const third = duration / 3;
  return [
    `[0.0s–${third.toFixed(1)}s] Establish the exact geography, subject positions, eyelines and dramatic objective.`,
    `[${third.toFixed(1)}s–${(third * 2).toFixed(1)}s] Execute the central action with readable cause, contact, weight and reaction.`,
    `[${(third * 2).toFixed(1)}s–${duration.toFixed(1)}s] Resolve into a stable continuity-safe end frame for the next shot.`,
  ];
}

export function buildMotionProductionPrompt(packet, direction = {}) {
  const refs = referenceInstructions(packet.references);
  const characters = packet.characters.map((character) => `${character.name} [${character.id}]${character.voiceDirection ? ` — performance/voice: ${character.voiceDirection}` : ''}`);
  const style = [
    ...lines(direction.style),
    ...Object.entries(packet.visualDirection || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`),
  ];
  const camera = [
    ...lines(direction.camera),
    ...Object.entries(packet.cameraDirection || {}).map(([key, value]) => `${key}: ${String(value)}`),
    'Use motivated camera movement, intentional asymmetry, foreground depth and preserved screen direction. Avoid constantly centered tracking.',
  ];
  const projectRule = /sankofi/i.test(packet.project.name)
    ? 'SANKOFI: preserve the approved painterly PBR stylized 3D direction; action is fast and coordinated with credible impact, weight and follow-through.'
    : /colony zero|palava 231/i.test(packet.project.name)
      ? 'Preserve approved Liberian dialogue, cadence and performance direction exactly; do not neutralize or replace it.'
      : '';
  return [
    '[GENERATION GOAL]',
    direction.goal || packet.script.text || 'Produce the requested shot as one coherent cinematic event.',
    '', '[LOCKED IDENTITIES / REFERENCES]', ...(refs.length ? refs : ['No external visual references are assigned; do not invent recurring-character identity.']),
    '', '[CHARACTERS / PERFORMANCE]', ...(characters.length ? characters : ['No named recurring character is assigned.']),
    ...(projectRule ? [projectRule] : []),
    '', '[SCENE GEOGRAPHY / BLOCKING]', ...(lines(direction.blocking).length ? lines(direction.blocking) : ['Keep every subject’s starting side, depth, eyeline, path and prop contact explicit and spatially consistent.']),
    '', '[ACTION TIMING]', ...timedBeats(packet),
    '', '[CAMERA / OPTICS]', ...camera,
    '', '[LIGHT / ENVIRONMENT / MATERIALS]', ...(style.length ? style : ['Motivated practical light, stable exposure and shadow direction, coherent reflections, tactile materials and readable subject separation.']),
    '', '[PHYSICS / CONTACT / FOLLOW-THROUGH]', ...(lines(direction.physics).length ? lines(direction.physics) : ['Believable anatomy, weight, momentum, collisions, cloth, object permanence, hand contact and reaction timing.']),
    '', '[SOUND / DIALOGUE POLICY]', ...packet.voicePolicy.instructions, `Voice mode: ${packet.voicePolicy.mode}. Never auto-select a substitute voice.`, ...(lines(direction.sound).length ? lines(direction.sound) : ['Synchronize only authorized dialogue and visible production sound; preserve room tone and material contact.']),
    '', '[CONTINUITY]', ...packet.continuityRules,
    '', '[NEGATIVE / FAILURE PREVENTION]',
    'No identity drift, face changes, anatomy errors, extra limbs, warped hands, duplicate subjects, disappearing props, object morphing, geography flips, lighting jumps, random cuts, camera teleportation, flicker, subtitles, logos or watermarks.',
    `Technical: ${packet.generation.aspectRatio}, ${packet.generation.resolution}, ${packet.generation.durationSeconds}s, ${packet.generation.mode}.`,
  ].filter((line) => line !== undefined).join('\n').trim();
}

