// packages/electron/src/main/services/trackerPlan/__tests__/exitPlanModeRouting.test.ts
import { describe, it, expect } from 'vitest';
import { isTrackerPlanSession } from '../isTrackerPlanSession';

describe('isTrackerPlanSession', () => {
  it('returns the binding for a tracker-plan session (object or JSON string metadata)', () => {
    const meta = { kind: 'tracker-plan', trackerItemId: 'id1', issueKey: 'BUG-001' };
    expect(isTrackerPlanSession(meta)).toEqual({ trackerItemId: 'id1', issueKey: 'BUG-001' });
    expect(isTrackerPlanSession(JSON.stringify(meta))).toEqual({ trackerItemId: 'id1', issueKey: 'BUG-001' });
  });

  it('falls back to trackerItemId when issueKey is missing', () => {
    const meta = { kind: 'tracker-plan', trackerItemId: 'id1' };
    expect(isTrackerPlanSession(meta)).toEqual({ trackerItemId: 'id1', issueKey: 'id1' });
  });

  it('returns null for normal sessions', () => {
    expect(isTrackerPlanSession({ kind: 'chat' })).toBeNull();
    expect(isTrackerPlanSession(null)).toBeNull();
    expect(isTrackerPlanSession(undefined)).toBeNull();
    expect(isTrackerPlanSession('not json')).toBeNull();
    // tracker-plan kind but no trackerItemId -> not actionable
    expect(isTrackerPlanSession({ kind: 'tracker-plan' })).toBeNull();
  });
});
