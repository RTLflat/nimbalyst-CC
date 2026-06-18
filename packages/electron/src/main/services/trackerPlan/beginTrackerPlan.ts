// packages/electron/src/main/services/trackerPlan/beginTrackerPlan.ts
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';

export async function beginTrackerPlan(args: {
  itemId: string;
  sessionId: string;
  workspacePath: string;
  priorStatus: string;
}): Promise<void> {
  await handleTrackerUpdate(
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
}
