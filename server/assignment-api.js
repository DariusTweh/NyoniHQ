import { start } from 'workflow/api';
import { runNyoniAssignmentWorkflow } from '../workflows/nyoni-assignment.js';
import { actOnAssignment, createAssignment, listAssignments, updateAssignmentRunId } from './nyoni-store.js';

export async function getAssignments() {
  return { assignments: await listAssignments() };
}

export async function postAssignment(body) {
  const assignment = await createAssignment(body || {});
  const run = await start(runNyoniAssignmentWorkflow, [assignment.id]);
  const runId = run.runId || run.id;
  if (runId) await updateAssignmentRunId(assignment.id, runId);
  return { assignment: { ...assignment, workflow_run_id: runId || null } };
}

export async function patchAssignment(body) {
  const { assignmentId, action } = body || {};
  const assignment = await actOnAssignment(assignmentId, action);
  let runId = null;
  if (action === 'retry' || action === 'reject') {
    const run = await start(runNyoniAssignmentWorkflow, [assignment.id]);
    runId = run.runId || run.id;
    if (runId) await updateAssignmentRunId(assignment.id, runId);
  }
  return { assignment: { ...assignment, workflow_run_id: runId || assignment.workflow_run_id } };
}
