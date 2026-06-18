// packages/electron/src/main/services/trackerPlan/completeTrackerPlan.ts
import fs from 'fs/promises';
import path from 'path';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import { planAbsolutePath, extractSummary, composeDescription } from './planPaths';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';

export async function completeTrackerPlan(args: {
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

  const result = await handleTrackerUpdate(
    {
      id: args.itemId,
      status: 'ready',
      description: composeDescription(summary, canonical),
      fields: {
        plan: {
          status: 'planned',
          path: canonical,
          summary,
          sessionId: args.sessionId,
          createdAt: new Date().toISOString(),
        },
      },
    },
    args.workspacePath,
  );
  if (result?.isError) {
    throw new Error(`completeTrackerPlan: failed to update tracker item ${args.itemId}`);
  }

  await AISessionsRepository.updateMetadata(args.sessionId, { isArchived: true });

  return { planPath: canonical };
}
