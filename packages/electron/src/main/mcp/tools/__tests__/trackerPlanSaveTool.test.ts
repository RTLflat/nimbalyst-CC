import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that might trigger them
// ---------------------------------------------------------------------------
const {
  mockQuery,
  mockCompleteTrackerPlan,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCompleteTrackerPlan: vi.fn(),
}));

vi.mock('../../../database/initialize', () => ({
  getDatabase: () => ({
    query: mockQuery,
  }),
}));

vi.mock('../../../services/trackerPlan/completeTrackerPlan', () => ({
  completeTrackerPlan: mockCompleteTrackerPlan,
}));

// isTrackerPlanSession is a pure function — use the real impl via a spy
// so we exercise the full parsing logic
vi.mock('../../../services/trackerPlan/isTrackerPlanSession', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../services/trackerPlan/isTrackerPlanSession')>();
  return real;
});

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------
import { handleTrackerPlanSave } from '../trackerPlanSaveTool';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTrackerPlanMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'tracker-plan',
    trackerItemId: 'plan_abc123',
    issueKey: 'NIM-42',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('handleTrackerPlanSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteTrackerPlan.mockResolvedValue({ planPath: '/workspace/.planning/plans/NIM-42-plan.md' });
  });

  // -------------------------------------------------------------------------
  // (a) Happy path: tracker-plan session — resolves binding from session,
  //     calls completeTrackerPlan with correct args, returns success.
  // -------------------------------------------------------------------------
  describe('tracker-plan session (metadata is an object)', () => {
    it('calls completeTrackerPlan with planFilePath, planSummary, itemId, issueKey', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ metadata: makeTrackerPlanMetadata() }],
      });

      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'A concise summary of the plan.' },
        '/workspace',
        'session-xyz',
      );

      expect(mockCompleteTrackerPlan).toHaveBeenCalledTimes(1);
      expect(mockCompleteTrackerPlan).toHaveBeenCalledWith({
        itemId: 'plan_abc123',
        issueKey: 'NIM-42',
        workspacePath: '/workspace',
        sessionId: 'session-xyz',
        planFilePath: '/workspace/plan.md',
        planSummary: 'A concise summary of the plan.',
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload.ok).toBe(true);
      expect(payload.planPath).toBe('/workspace/.planning/plans/NIM-42-plan.md');
      expect(payload.issueKey).toBe('NIM-42');
    });
  });

  describe('tracker-plan session (metadata is a JSON string)', () => {
    it('parses JSON string metadata and resolves binding', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ metadata: JSON.stringify(makeTrackerPlanMetadata()) }],
      });

      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        '/workspace',
        'session-xyz',
      );

      expect(mockCompleteTrackerPlan).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // (b) Non-tracker session — returns isError, does NOT call completeTrackerPlan
  // -------------------------------------------------------------------------
  describe('non-tracker-plan session', () => {
    it('returns isError and skips completeTrackerPlan when kind differs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ metadata: { kind: 'normal', trackerItemId: 'some_id' } }],
      });

      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        '/workspace',
        'session-xyz',
      );

      expect(mockCompleteTrackerPlan).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('not a tracker-plan session');
    });

    it('returns isError when metadata has no kind', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ metadata: {} }],
      });

      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        '/workspace',
        'session-xyz',
      );

      expect(mockCompleteTrackerPlan).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
    });

    it('returns isError when session row is not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        '/workspace',
        'session-xyz',
      );

      expect(mockCompleteTrackerPlan).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Guard: missing sessionId or workspacePath
  // -------------------------------------------------------------------------
  describe('missing context', () => {
    it('returns isError immediately when sessionId is undefined', async () => {
      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        '/workspace',
        undefined,
      );

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCompleteTrackerPlan).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
    });

    it('returns isError immediately when workspacePath is undefined', async () => {
      const result = await handleTrackerPlanSave(
        { planPath: '/workspace/plan.md', summary: 'Summary.' },
        undefined,
        'session-xyz',
      );

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCompleteTrackerPlan).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
    });
  });
});
