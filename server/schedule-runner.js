import { postAssignment } from './assignment-api.js';
import { studioOwner } from './nyoni-store.js';

function nextRun(from, cadenceMinutes) {
  const now = Date.now();
  const scheduled = new Date(from).getTime();
  return new Date(Math.max(now, scheduled) + Number(cadenceMinutes) * 60_000).toISOString();
}

export async function runDueSchedules(env = process.env) {
  const { client, ownerId } = await studioOwner(env);
  const now = new Date().toISOString();
  const { data: due, error } = await client.from('nyoni_schedules').select('*')
    .eq('owner_id', ownerId).eq('enabled', true).lte('next_run_at', now)
    .order('next_run_at', { ascending: true }).limit(10);
  if (error) throw new Error(`Schedule lookup failed: ${error.message}`);

  const results = [];
  for (const schedule of due || []) {
    const reservedNextRun = nextRun(schedule.next_run_at, schedule.cadence_minutes);
    const { data: reserved, error: reserveError } = await client.from('nyoni_schedules')
      .update({ next_run_at: reservedNextRun, updated_at: now })
      .eq('id', schedule.id).eq('owner_id', ownerId).eq('next_run_at', schedule.next_run_at)
      .select('id').maybeSingle();
    if (reserveError || !reserved) {
      results.push({ scheduleId: schedule.id, name: schedule.name, status: 'already_claimed' });
      continue;
    }

    try {
      const bucket = new Date(schedule.next_run_at).toISOString();
      const result = await postAssignment({
        title: schedule.prompt,
        agentId: schedule.agent_id,
        project: schedule.project_name,
        idempotencyKey: `schedule:${schedule.id}:${bucket}`,
      });
      await client.from('nyoni_schedules').update({
        last_run_at: now,
        last_assignment_id: result.assignment.id,
        updated_at: new Date().toISOString(),
      }).eq('id', schedule.id).eq('owner_id', ownerId);
      results.push({ scheduleId: schedule.id, name: schedule.name, status: 'started', assignmentId: result.assignment.id });
    } catch (runError) {
      await client.from('nyoni_schedules').update({
        next_run_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        metadata: { ...(schedule.metadata || {}), lastError: runError?.message || 'Schedule failed', lastErrorAt: now },
        updated_at: new Date().toISOString(),
      }).eq('id', schedule.id).eq('owner_id', ownerId);
      results.push({ scheduleId: schedule.id, name: schedule.name, status: 'failed', error: runError?.message || 'Schedule failed' });
    }
  }
  return { checkedAt: now, due: due?.length || 0, results };
}
