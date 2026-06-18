// packages/electron/src/main/services/trackerPlan/isTrackerPlanSession.ts

/**
 * Pure routing helper. Given the raw `ai_sessions.metadata` value (which is a
 * parsed object on PGLite but may arrive as a JSON string on SQLite — see
 * DATABASE.md), decide whether it identifies a "Plan this item" planning
 * session and, if so, return the tracker binding.
 *
 * Returns null for every non-tracker-plan session.
 */
export function isTrackerPlanSession(
  metadata: unknown,
): { trackerItemId: string; issueKey: string } | null {
  const m = typeof metadata === 'string' ? safeParse(metadata) : ((metadata as Record<string, unknown>) || {});
  if (m && m.kind === 'tracker-plan' && m.trackerItemId) {
    const trackerItemId = String(m.trackerItemId);
    const issueKey = m.issueKey ? String(m.issueKey) : trackerItemId;
    return { trackerItemId, issueKey };
  }
  return null;
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
