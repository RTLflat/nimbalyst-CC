// packages/electron/src/main/services/trackerPlan/revertAbandonedPlan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks (hoisted — factories must not reference outer const vars) ---

vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { get: vi.fn() },
}));

vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerUpdate: vi.fn(async () => ({ isError: false })),
}));

// getDatabase returns a stable object; the query fn on that object is what we
// control per-test via dbQueryMock below.
vi.mock('../../database/initialize', () => {
  const dbQueryMock = vi.fn();
  return { getDatabase: vi.fn(() => ({ query: dbQueryMock })), _dbQueryMock: dbQueryMock };
});

// --- subject under test ---
import { revertAbandonedPlan } from './revertAbandonedPlan';

// --- grab the mocked references after imports ---
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import * as dbInitialize from '../../database/initialize';

const sessionGetMock = AISessionsRepository.get as ReturnType<typeof vi.fn>;
const handleTrackerUpdateMock = handleTrackerUpdate as ReturnType<typeof vi.fn>;
// Access the stable dbQueryMock from the module internals via getDatabase().query
function getDbQueryMock() {
  return (dbInitialize.getDatabase() as any).query as ReturnType<typeof vi.fn>;
}

// --- helpers ---

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    workspacePath: '/ws',
    metadata: {
      kind: 'tracker-plan',
      trackerItemId: 'item-1',
      issueKey: 'BUG-001',
    },
    ...overrides,
  };
}

function makeRow(planOverrides: Record<string, unknown> = {}) {
  return {
    id: 'row-uuid',
    data: JSON.stringify({
      plan: {
        status: 'planning',
        sessionId: 'sess-1',
        priorStatus: 'backlog',
        ...planOverrides,
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('revertAbandonedPlan', () => {
  it('reverts status to priorStatus and clears data.plan when session is in planning state', async () => {
    sessionGetMock.mockResolvedValue(makeSession());
    getDbQueryMock().mockResolvedValue({ rows: [makeRow()] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).toHaveBeenCalledOnce();
    const call = handleTrackerUpdateMock.mock.calls[0][0];
    expect(call.id).toBe('item-1');
    expect(call.status).toBe('backlog');
    expect(call.fields.plan).toBeNull();
    expect(handleTrackerUpdateMock.mock.calls[0][1]).toBe('/ws');
  });

  it('falls back to to-do when priorStatus is missing', async () => {
    sessionGetMock.mockResolvedValue(makeSession());
    getDbQueryMock().mockResolvedValue({ rows: [makeRow({ priorStatus: undefined })] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    const call = handleTrackerUpdateMock.mock.calls[0][0];
    expect(call.status).toBe('to-do');
  });

  it('is a no-op when the plan is already status=planned (completed plan must not be reverted)', async () => {
    sessionGetMock.mockResolvedValue(makeSession());
    getDbQueryMock().mockResolvedValue({ rows: [makeRow({ status: 'planned' })] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the session is not a tracker-plan session', async () => {
    sessionGetMock.mockResolvedValue(makeSession({ metadata: { kind: 'chat' } }));

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
    // DB must not be queried since the session binding check short-circuits
    expect(getDbQueryMock()).not.toHaveBeenCalled();
  });

  it('is a no-op when the session cannot be found', async () => {
    sessionGetMock.mockResolvedValue(null);

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the tracker item row cannot be found', async () => {
    sessionGetMock.mockResolvedValue(makeSession());
    getDbQueryMock().mockResolvedValue({ rows: [] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the item has no data.plan marker', async () => {
    sessionGetMock.mockResolvedValue(makeSession());
    getDbQueryMock().mockResolvedValue({ rows: [{ id: 'row-uuid', data: JSON.stringify({}) }] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: '/ws' });

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
  });

  it('uses the session workspacePath when the caller does not supply one', async () => {
    sessionGetMock.mockResolvedValue(makeSession({ workspacePath: '/ws-from-session' }));
    getDbQueryMock().mockResolvedValue({ rows: [makeRow()] });

    await revertAbandonedPlan({ sessionId: 'sess-1', workspacePath: undefined as any });

    expect(handleTrackerUpdateMock.mock.calls[0][1]).toBe('/ws-from-session');
  });
});
