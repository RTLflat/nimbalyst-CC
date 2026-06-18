// packages/electron/src/main/mcp/tools/trackerPlanSaveTool.ts
import { isTrackerPlanSession } from '../../services/trackerPlan/isTrackerPlanSession';
import { completeTrackerPlan } from '../../services/trackerPlan/completeTrackerPlan';

type McpToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export const trackerPlanSaveSchema = {
  name: 'tracker_plan_save',
  description:
    'Save the completed implementation plan for the current tracker-plan session: records the plan file, rewrites the item description, marks it Ready, and ends the planning session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      planPath: {
        type: 'string',
        description: 'Absolute path to the written plan file',
      },
      summary: {
        type: 'string',
        description: '2-4 sentence summary of the plan',
      },
    },
    required: ['planPath', 'summary'],
  },
};

export async function handleTrackerPlanSave(
  args: { planPath: string; summary: string },
  workspacePath: string | undefined,
  sessionId: string | undefined,
): Promise<McpToolResult> {
  if (!sessionId || !workspacePath) {
    return {
      content: [
        {
          type: 'text',
          text: 'tracker_plan_save: not a tracker-plan session (no sessionId or workspacePath)',
        },
      ],
      isError: true,
    };
  }

  // Read session metadata — use dynamic import to match the codebase's lazy
  // initialization pattern for the database accessor (avoids circular deps
  // and init-ordering issues in the main process).
  const { getDatabase } = await import('../../database/initialize');
  const db = getDatabase();
  const sessionResult = await db.query<{ metadata: unknown }>(
    'SELECT metadata FROM ai_sessions WHERE id = $1',
    [sessionId],
  );

  const row = sessionResult.rows[0];
  const rawMetadata = row?.metadata;
  // Defensive: PGLite returns an object, SQLite returns a JSON string.
  const metadata = typeof rawMetadata === 'string' ? safeParse(rawMetadata) : rawMetadata;

  const binding = isTrackerPlanSession(metadata);
  if (!binding) {
    return {
      content: [
        {
          type: 'text',
          text: 'tracker_plan_save: not a tracker-plan session',
        },
      ],
      isError: true,
    };
  }

  const result = await completeTrackerPlan({
    itemId: binding.trackerItemId,
    issueKey: binding.issueKey,
    workspacePath,
    sessionId,
    planFilePath: args.planPath,
    planSummary: args.summary,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          planPath: result.planPath,
          issueKey: binding.issueKey,
          message: `Plan saved and tracker item marked ready. Plan file: ${result.planPath}`,
        }),
      },
    ],
  };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
