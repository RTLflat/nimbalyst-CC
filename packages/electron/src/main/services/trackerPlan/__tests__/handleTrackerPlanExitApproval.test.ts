// packages/electron/src/main/services/trackerPlan/__tests__/handleTrackerPlanExitApproval.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleTrackerPlanExitApproval } from '../handleTrackerPlanExitApproval';

const trackerPlanMeta = { kind: 'tracker-plan', trackerItemId: 'id1', issueKey: 'BUG-001' };

describe('handleTrackerPlanExitApproval', () => {
  it('captures the plan and resolves as deny (no mode=agent) for an approved tracker-plan session', async () => {
    const onPlanApproved = vi.fn(async () => ({ planPath: '/ws/nimbalyst-local/plans/BUG-001-plan.md' }));
    const readPlanRequest = vi.fn(async () => ({ planFilePath: '/tmp/plan.md', planSummary: 'Fix it.' }));
    const resolveConfirmation = vi.fn();

    const result = await handleTrackerPlanExitApproval({
      requestId: 'req-1',
      sessionId: 's1',
      workspacePath: '/ws',
      metadata: trackerPlanMeta,
      response: { approved: true },
      readPlanRequest,
      onPlanApproved,
      resolveConfirmation,
    });

    expect(result.handled).toBe(true);
    expect(result.shouldSetAgentMode).toBe(false);

    // (a) onPlanApproved called with the right args
    expect(onPlanApproved).toHaveBeenCalledTimes(1);
    expect(onPlanApproved).toHaveBeenCalledWith({
      itemId: 'id1',
      issueKey: 'BUG-001',
      workspacePath: '/ws',
      sessionId: 's1',
      planFilePath: '/tmp/plan.md',
      planSummary: 'Fix it.',
    });

    // plan captured BEFORE the deny resolves
    expect(onPlanApproved.mock.invocationCallOrder[0])
      .toBeLessThan(resolveConfirmation.mock.invocationCallOrder[0]);

    // (a) resolves as deny so the agent does NOT implement
    expect(resolveConfirmation).toHaveBeenCalledTimes(1);
    const [reqId, resolvedResponse] = resolveConfirmation.mock.calls[0];
    expect(reqId).toBe('req-1');
    expect(resolvedResponse.approved).toBe(false);
    expect(typeof resolvedResponse.feedback).toBe('string');
  });

  it('returns not handled for a non-tracker session and makes no calls', async () => {
    const onPlanApproved = vi.fn();
    const readPlanRequest = vi.fn();
    const resolveConfirmation = vi.fn();

    const result = await handleTrackerPlanExitApproval({
      requestId: 'req-1',
      sessionId: 's1',
      workspacePath: '/ws',
      metadata: { kind: 'chat' },
      response: { approved: true },
      readPlanRequest,
      onPlanApproved,
      resolveConfirmation,
    });

    expect(result.handled).toBe(false);
    expect(onPlanApproved).not.toHaveBeenCalled();
    expect(readPlanRequest).not.toHaveBeenCalled();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });

  it('does not capture a plan on denial of a tracker-plan session', async () => {
    const onPlanApproved = vi.fn();
    const readPlanRequest = vi.fn();
    const resolveConfirmation = vi.fn();

    const result = await handleTrackerPlanExitApproval({
      requestId: 'req-1',
      sessionId: 's1',
      workspacePath: '/ws',
      metadata: trackerPlanMeta,
      response: { approved: false },
      readPlanRequest,
      onPlanApproved,
      resolveConfirmation,
    });

    // It is a tracker-plan session, but a denial needs no special capture —
    // leave it to the normal (default) path.
    expect(result.handled).toBe(false);
    expect(onPlanApproved).not.toHaveBeenCalled();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });

  it('does not resolve as deny when the durable plan request is missing (falls through)', async () => {
    const onPlanApproved = vi.fn();
    const readPlanRequest = vi.fn(async () => ({ planFilePath: '', planSummary: undefined }));
    const resolveConfirmation = vi.fn();

    const result = await handleTrackerPlanExitApproval({
      requestId: 'req-1',
      sessionId: 's1',
      workspacePath: '/ws',
      metadata: trackerPlanMeta,
      response: { approved: true },
      readPlanRequest,
      onPlanApproved,
      resolveConfirmation,
    });

    // Missing plan file -> do NOT swallow: report not-handled so the caller
    // runs the normal allow/mode=agent path (prompt does not hang).
    expect(result.handled).toBe(false);
    expect(result.missingPlan).toBe(true);
    expect(onPlanApproved).not.toHaveBeenCalled();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });
});
