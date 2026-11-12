import { Client } from 'eve/client';

const client = new Client({ baseUrl: '' });

function phaseForEvent(event) {
  if (event.type === 'delivery.consumed') return 'Creative received the brief';
  if (event.type === 'model.requested') return 'Creative is shaping the direction';
  if (event.type === 'model.started') return 'Creative is developing the concept';
  if (event.type === 'content.delta') return 'Creative is writing the brief';
  if (event.type === 'content.completed') return 'Creative is finishing the deliverable';
  if (event.type === 'model.retried') return 'Creative is retrying the model call';
  return null;
}

export async function checkCreativeAgent() {
  return client.health();
}

export async function runCreativeAssignment(task, onUpdate = () => {}) {
  const prompt = [
    'Create a production-ready creative direction for this Nyoni Studios assignment.',
    `ASSIGNMENT: ${task.title}`,
    `PROJECT: ${task.project}`,
    'Return the requested labeled creative brief. This is a draft for human review; do not claim to have executed or published anything.',
  ].join('\n\n');

  onUpdate('Connecting to Creative');
  const { session, delivery } = await client.sessions.create({
    message: prompt,
    clientContext: {
      application: 'Nyoni HQ',
      agent: 'Creative',
      taskId: task.id,
      project: task.project,
    },
  });

  try {
    for await (const event of delivery.stream()) {
      const phase = phaseForEvent(event);
      if (phase) onUpdate(phase, event);
    }

    const result = await delivery.result();
    if (result.status !== 'completed' || !result.reply?.trim()) {
      const message = result.error?.message || `Creative stopped with status: ${result.status}`;
      throw new Error(message);
    }
    onUpdate('Creative brief ready for approval');
    return {
      output: result.reply.trim(),
      sessionId: session.id,
    };
  } finally {
    void session.end({ reason: 'Nyoni HQ assignment complete' }).then((receipt) => receipt.result()).catch(() => {});
  }
}
