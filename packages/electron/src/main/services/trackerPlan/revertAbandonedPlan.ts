// packages/electron/src/main/services/trackerPlan/revertAbandonedPlan.ts
//
// Called from every session-delete path (ai:deleteSession, session:delete,
// sessions:delete) BEFORE the session row is removed so the metadata is still
// readable. If the deleted session was an in-progress tracker-plan session
// (data.plan.status === 'planning'), the item is reverted to its prior status
// and the plan marker is cleared.
//
// KNOWN LIMITATION: if the user stops the agent or navigates away without
// deleting the session, the item stays in 'planning'. That is intentional —
// wiring to endSession or ai:cancelRequest fires on every agent turn settle /
// single-turn interruption and would cause false reverts mid-planning. A
// startup reconciliation pass or an explicit "cancel planning" action is a
// possible follow-up.

import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { getDatabase } from '../../database/initialize';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import { isTrackerPlanSession } from './isTrackerPlanSession';

export async function revertAbandonedPlan(args: {
  sessionId: string;
  workspacePath: string | undefined;
}): Promise<void> {
  const { sessionId } = args;

  // Read session so we have its metadata and workspacePath.
  const session = await AISessionsRepository.get(sessionId);
  if (!session) return;

  const binding = isTrackerPlanSession(session.metadata);
  if (!binding) return;

  const workspacePath = args.workspacePath ?? session.workspacePath;

  // Read the tracker item row to inspect data.plan.
  const db = getDatabase();
  const result = await db.query<any>(
    `SELECT id, data FROM tracker_items WHERE (id = $1 OR issue_key = $1) ORDER BY updated DESC LIMIT 1`,
    [binding.trackerItemId],
  );

  const row = result.rows[0];
  if (!row) return;

  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {});
  const plan = data.plan;
  if (!plan) return;

  // A completed plan must never be reverted.
  if (plan.status === 'planned') return;

  const priorStatus: string = plan.priorStatus || 'to-do';

  await handleTrackerUpdate(
    {
      id: binding.trackerItemId,
      status: priorStatus,
      fields: { plan: null },
    },
    workspacePath,
  );
}
