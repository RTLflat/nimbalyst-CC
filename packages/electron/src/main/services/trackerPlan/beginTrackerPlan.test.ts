// packages/electron/src/main/services/trackerPlan/beginTrackerPlan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerUpdate: vi.fn(async () => ({ isError: false })),
}));

import { beginTrackerPlan } from './beginTrackerPlan';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('beginTrackerPlan', () => {
  it('calls handleTrackerUpdate with status:planning and fields.plan.status=planning', async () => {
    await beginTrackerPlan({
      itemId: 'item-1',
      sessionId: 'sess-abc',
      workspacePath: '/ws',
      priorStatus: 'backlog',
    });

    expect(handleTrackerUpdate).toHaveBeenCalledOnce();
    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.id).toBe('item-1');
    expect(call.status).toBe('planning');
    expect(call.fields.plan.status).toBe('planning');
  });

  it('stamps fields.plan.sessionId with the provided sessionId', async () => {
    await beginTrackerPlan({
      itemId: 'item-2',
      sessionId: 'sess-xyz',
      workspacePath: '/ws',
      priorStatus: 'in-progress',
    });

    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.fields.plan.sessionId).toBe('sess-xyz');
  });

  it('stamps fields.plan.priorStatus with the provided priorStatus', async () => {
    await beginTrackerPlan({
      itemId: 'item-3',
      sessionId: 'sess-123',
      workspacePath: '/ws',
      priorStatus: 'ready',
    });

    const call = (handleTrackerUpdate as any).mock.calls[0][0];
    expect(call.fields.plan.priorStatus).toBe('ready');
  });

  it('passes workspacePath as the second argument to handleTrackerUpdate', async () => {
    await beginTrackerPlan({
      itemId: 'item-4',
      sessionId: 'sess-456',
      workspacePath: '/my/workspace',
      priorStatus: 'backlog',
    });

    const secondArg = (handleTrackerUpdate as any).mock.calls[0][1];
    expect(secondArg).toBe('/my/workspace');
  });

  it('throws when handleTrackerUpdate returns isError:true', async () => {
    (handleTrackerUpdate as any).mockResolvedValueOnce({ isError: true });

    await expect(
      beginTrackerPlan({
        itemId: 'item-err',
        sessionId: 'sess-err',
        workspacePath: '/ws',
        priorStatus: 'to-do',
      }),
    ).rejects.toThrow('item-err');
  });
});
