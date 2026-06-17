import { describe, it, expect, vi, beforeEach } from 'vitest';

// Heavy/IO collaborators mocked; gating + researchContent are real (pure, tested).
const queryMock = vi.fn();
vi.mock('../../../database/initialize', () => ({ getDatabase: () => ({ query: queryMock }) }));

const settingMock = vi.fn((..._args: any[]) => true);
const defaultModelMock = vi.fn(() => 'claude-code:opus');
vi.mock('../../../utils/store', () => ({
  getAutoTrackerResearchEnabled: (...a: any[]) => settingMock(...a),
  getDefaultAIModel: () => defaultModelMock(),
}));

vi.mock('../../GitStatusService', () => ({
  GitStatusService: class { async isGitRepo() { return true; } },
}));

const runTurnMock = vi.fn();
vi.mock('../../MetaAgentService', () => ({
  MetaAgentService: { getInstance: () => ({ runHeadlessReadOnlyTurn: runTurnMock }) },
}));

const handleTrackerUpdateMock = vi.fn(async (..._args: any[]) => ({}));
vi.mock('../../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerUpdate: (...a: any[]) => handleTrackerUpdateMock(...a),
}));

import { TrackerResearchService } from '../TrackerResearchService';

function freshService() {
  // Each test gets a clean instance (avoid shared concurrency state).
  (TrackerResearchService as any).instance = null;
  return TrackerResearchService.getInstance();
}

beforeEach(() => {
  vi.clearAllMocks();
  settingMock.mockReturnValue(true);
  defaultModelMock.mockReturnValue('claude-code:opus');
});

describe('TrackerResearchService.runForItem', () => {
  it('runs research and writes the composed body when gated in', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i1', type: 'task', source: 'native', data: { title: 'Fix theme', createdByAgent: false } }] });
    runTurnMock.mockResolvedValue({ status: 'done', text: 'Relevant: Foo.ts' });

    await freshService().runForItem('i1', '/ws');

    // running first, then the body+done write
    const descCall = handleTrackerUpdateMock.mock.calls.find((c) => typeof c[0]?.description === 'string');
    expect(descCall).toBeTruthy();
    expect(descCall![0].description).toContain('Relevant: Foo.ts');
    expect(descCall![0].fields.research.status).toBe('done');
    const runningCall = handleTrackerUpdateMock.mock.calls.find((c) => c[0]?.fields?.research?.status === 'running');
    expect(runningCall).toBeTruthy();
  });

  it('writes the partial body with a not-exhaustive note when research times out', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i5', type: 'task', source: 'native', data: { title: 'Big task', createdByAgent: false } }] });
    runTurnMock.mockResolvedValue({ status: 'partial', text: 'Relevant: Foo.ts' });

    await freshService().runForItem('i5', '/ws');

    const descCall = handleTrackerUpdateMock.mock.calls.find((c) => typeof c[0]?.description === 'string');
    expect(descCall).toBeTruthy();
    expect(descCall![0].description).toContain('Relevant: Foo.ts');
    expect(descCall![0].description.toLowerCase()).toContain('not exhaustive');
    expect(descCall![0].fields.research.status).toBe('partial');
  });

  it('marks failed when the agent returns no text', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i2', type: 'bug', source: 'native', data: {} }] });
    runTurnMock.mockResolvedValue({ status: 'failed', text: '' });

    await freshService().runForItem('i2', '/ws');

    const failed = handleTrackerUpdateMock.mock.calls.find((c) => c[0]?.fields?.research?.status === 'failed');
    expect(failed).toBeTruthy();
    // No body write on failure
    expect(handleTrackerUpdateMock.mock.calls.some((c) => typeof c[0]?.description === 'string')).toBe(false);
  });

  it('does nothing when gated out (agent-created)', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i3', type: 'task', source: 'native', data: { createdByAgent: true } }] });

    await freshService().runForItem('i3', '/ws');

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', async () => {
    settingMock.mockReturnValue(false);
    queryMock.mockResolvedValue({ rows: [{ id: 'i4', type: 'task', source: 'native', data: {} }] });

    await freshService().runForItem('i4', '/ws');

    expect(handleTrackerUpdateMock).not.toHaveBeenCalled();
  });
});
