// packages/electron/src/main/services/trackerPlan/completeTrackerPlan.test.ts
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
vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: {
    updateMetadata: vi.fn(async () => {}),
  },
}));

import { completeTrackerPlan } from './completeTrackerPlan';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';

beforeEach(() => { updates.length = 0; vi.clearAllMocks(); });

describe('completeTrackerPlan', () => {
  it('calls handleTrackerUpdate with status:ready, description containing summary + plan path, and stamps data.plan as planned', async () => {
    const res = await completeTrackerPlan({
      itemId: 'id1', issueKey: 'BUG-001', workspacePath: '/ws',
      sessionId: 's1', planFilePath: '/ws/nimbalyst-local/plans/BUG-001-plan.md',
    });
    const canonical = '/ws/nimbalyst-local/plans/BUG-001-plan.md';
    expect(res.planPath).toBe(canonical);

    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.id).toBe('id1');
    expect(call.status).toBe('ready');
    expect(call.description).toContain('Fix the crash.');
    expect(call.description).toContain(`**Plan:** \`${canonical}\``);
    expect(call.fields.plan.status).toBe('planned');
    expect(call.fields.plan.path).toBe(canonical);
    expect(call.fields.plan.sessionId).toBe('s1');
  });

  it('archives the session after the tracker update', async () => {
    await completeTrackerPlan({
      itemId: 'id1', issueKey: 'BUG-001', workspacePath: '/ws',
      sessionId: 's1', planFilePath: '/ws/nimbalyst-local/plans/BUG-001-plan.md',
    });

    expect((AISessionsRepository.updateMetadata as any).mock.calls[0]).toEqual([
      's1', { isArchived: true },
    ]);

    // archive must come after tracker update
    const trackerOrder = (handleTrackerUpdate as any).mock.invocationCallOrder[0];
    const archiveOrder = (AISessionsRepository.updateMetadata as any).mock.invocationCallOrder[0];
    expect(archiveOrder).toBeGreaterThan(trackerOrder);
  });

  it('uses planSummary when provided instead of extracting from file', async () => {
    await completeTrackerPlan({
      itemId: 'id2', issueKey: 'FEAT-42', workspacePath: '/ws',
      sessionId: 's2', planFilePath: '/ws/nimbalyst-local/plans/FEAT-42-plan.md',
      planSummary: 'Custom summary text.',
    });

    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.description).toContain('Custom summary text.');
    expect(call.description).not.toContain('Fix the crash.');
  });

  it('returns planPath pointing to the canonical location', async () => {
    const res = await completeTrackerPlan({
      itemId: 'id3', issueKey: 'BUG-999', workspacePath: '/ws',
      sessionId: 's3', planFilePath: '/ws/nimbalyst-local/plans/BUG-999-plan.md',
    });
    expect(res.planPath).toBe('/ws/nimbalyst-local/plans/BUG-999-plan.md');
  });

  it('throws when handleTrackerUpdate returns isError:true and does NOT archive the session', async () => {
    (handleTrackerUpdate as any).mockResolvedValueOnce({ isError: true });

    await expect(
      completeTrackerPlan({
        itemId: 'id-err', issueKey: 'BUG-ERR', workspacePath: '/ws',
        sessionId: 's-err', planFilePath: '/ws/nimbalyst-local/plans/BUG-ERR-plan.md',
      }),
    ).rejects.toThrow('id-err');

    expect(AISessionsRepository.updateMetadata).not.toHaveBeenCalled();
  });
});
