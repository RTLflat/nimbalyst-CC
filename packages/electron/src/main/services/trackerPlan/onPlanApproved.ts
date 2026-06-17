// packages/electron/src/main/services/trackerPlan/onPlanApproved.ts
import fs from 'fs/promises';
import path from 'path';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import { planAbsolutePath, extractSummary, composeDescription } from './planPaths';

export async function onPlanApproved(args: {
  itemId: string;
  issueKey: string;
  workspacePath: string;
  sessionId: string;
  planFilePath: string;
  planSummary?: string;
}): Promise<{ planPath: string }> {
  const canonical = planAbsolutePath(args.workspacePath, args.issueKey);
  const content = await fs.readFile(args.planFilePath, 'utf-8');

  if (path.resolve(args.planFilePath) !== path.resolve(canonical)) {
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, content, 'utf-8');
  }

  const summary = (args.planSummary && args.planSummary.trim()) || extractSummary(content) || 'Implementation plan generated.';

  await handleTrackerUpdate(
    {
      id: args.itemId,
      description: composeDescription(summary, canonical),
      fields: {
        plan: {
          path: canonical,
          summary,
          createdAt: new Date().toISOString(),
          sessionId: args.sessionId,
          status: 'planned',
        },
      },
    },
    args.workspacePath,
  );

  return { planPath: canonical };
}
