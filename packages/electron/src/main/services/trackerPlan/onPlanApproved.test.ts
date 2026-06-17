// packages/electron/src/main/services/trackerPlan/onPlanApproved.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates: any[] = [];
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerUpdate: vi.fn(async (args: any) => { updates.push(args); return { isError: false }; }),
}));
vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn(async () => '## Summary\nFix the crash.\n\n## Risks / Open issues\n- none\n'),
             writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) },
  readFile: vi.fn(async () => '## Summary\nFix the crash.\n\n## Risks / Open issues\n- none\n'),
  writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
}));

import { onPlanApproved } from './onPlanApproved';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';

beforeEach(() => { updates.length = 0; vi.clearAllMocks(); });

describe('onPlanApproved', () => {
  it('rewrites the description with the summary + plan path and stamps data.plan', async () => {
    const res = await onPlanApproved({
      itemId: 'id1', issueKey: 'BUG-001', workspacePath: '/ws',
      sessionId: 's1', planFilePath: '/ws/nimbalyst-local/plans/BUG-001-plan.md',
    });
    expect(res.planPath).toBe('/ws/nimbalyst-local/plans/BUG-001-plan.md');
    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.id).toBe('id1');
    expect(call.description).toContain('Fix the crash.');
    expect(call.description).toContain('**Plan:** `/ws/nimbalyst-local/plans/BUG-001-plan.md`');
    expect(call.fields.plan.status).toBe('planned');
    expect(call.fields.plan.path).toBe('/ws/nimbalyst-local/plans/BUG-001-plan.md');
  });
});
