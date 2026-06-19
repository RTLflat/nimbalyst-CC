// packages/electron/src/main/services/trackerPlan/beginTrackerPlan.ts
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';

export async function beginTrackerPlan(args: {
  itemId: string;
  sessionId: string;
  workspacePath: string;
  priorStatus: string;
}): Promise<void> {
  const result = await handleTrackerUpdate(
    {
      id: args.itemId,
      status: 'planning',
      fields: {
        plan: {
          status: 'planning',
          sessionId: args.sessionId,
          priorStatus: args.priorStatus,
        },
      },
    },
    args.workspacePath,
  );
  if (result?.isError) {
    throw new Error(`beginTrackerPlan: failed to update tracker item ${args.itemId}`);
  }
}
