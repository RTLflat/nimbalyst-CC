// packages/electron/src/main/services/tracker/TrackerImportService.test.ts
//
// Characterization tests for TrackerImportService. These lock in TODAY's
// behavior of runImport / resnapshot / applyUpstreamBody / dismissUpstreamBodyChange
// so the Google-Sheets unification refactor (plan 013) has a before/after safety
// net. They assert real behavior — return values AND what the mocked
// dependencies were called with — not merely that the functions don't throw.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// --- hoisted mocks (defined before the hoisted vi.mock factories run) ---
const { mockRegistry, mockDbQuery } = vi.hoisted(() => ({
  mockRegistry: {
    fetchSnapshot: vi.fn(),
    findLocalIdByUrn: vi.fn(),
    getContribution: vi.fn(),
  },
  mockDbQuery: vi.fn(),
}));

vi.mock('./TrackerImporterRegistry', () => ({
  getTrackerImporterRegistry: () => mockRegistry,
}));
vi.mock('../../database/initialize', () => ({
  getDatabase: () => ({ query: mockDbQuery }),
}));
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerCreate: vi.fn(),
  handleTrackerUpdate: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { getTrackerImportService, importedItemId } from './TrackerImportService';
import { handleTrackerCreate, handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';

const create = handleTrackerCreate as unknown as ReturnType<typeof vi.fn>;
const update = handleTrackerUpdate as unknown as ReturnType<typeof vi.fn>;

const WS = '/ws';
const URN = 'github://owner/repo#42';

/** Mirror of the service's private hashBody so tests can predict body hashes. */
function hashBody(body?: string): string {
  return createHash('sha1').update(body ?? '').digest('hex');
}

/** Build an upstream importer snapshot (what registry.fetchSnapshot returns). */
function makeSnapshot(overrides: Record<string, any> = {}): any {
  const { external: extOver, ...rest } = overrides;
  return {
    external: {
      providerId: 'github-issues',
      externalId: '42',
      urn: URN,
      url: 'https://github.com/owner/repo/issues/42',
      titleSnapshot: 'Upstream title',
      stateSnapshot: 'open',
      ...extOver,
    },
    primaryType: 'bug',
    title: 'Upstream title',
    body: 'Upstream body',
    status: 'open',
    priority: 'high',
    labels: ['bug', 'p1'],
    ...rest,
  };
}

/** Build the stored external ref on a local row's data.origin.external. */
function makeStoredExternal(overrides: Record<string, any> = {}): any {
  return {
    providerId: 'github-issues',
    externalId: '42',
    urn: URN,
    url: 'https://github.com/owner/repo/issues/42',
    titleSnapshot: 'Local title',
    stateSnapshot: 'open',
    importedAt: '2026-01-01T00:00:00.000Z',
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
    bodyHash: hashBody('Old body'),
    upstreamBodyChanged: false,
    ...overrides,
  };
}

/** Build a db row (as loadByUrn / findLocalIdByUrn would see) and queue it on mockDbQuery. */
function queueLocalRow(args: {
  id?: string;
  title?: string;
  status?: string;
  labels?: string[];
  external?: Record<string, any> | null;
  origin?: any;
} = {}): { id: string; data: any } {
  const id = args.id ?? 'local-1';
  const data: any = {
    title: args.title ?? 'Local title',
    status: args.status ?? 'to-do',
    labels: args.labels ?? ['local-only'],
  };
  if (args.origin !== undefined) {
    data.origin = args.origin;
  } else if (args.external === null) {
    data.origin = { kind: 'native' };
  } else {
    data.origin = { kind: 'external', external: makeStoredExternal(args.external ?? {}) };
  }
  const row = { id, data };
  mockDbQuery.mockResolvedValue({ rows: [row] });
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRegistry.fetchSnapshot.mockReset();
  mockRegistry.findLocalIdByUrn.mockReset();
  mockRegistry.getContribution.mockReset();
  mockRegistry.getContribution.mockResolvedValue(null);
  mockDbQuery.mockReset();
  create.mockReset();
  create.mockResolvedValue({ isError: false });
  update.mockReset();
  update.mockResolvedValue({ isError: false });
});

const svc = () => getTrackerImportService();

// ---------------------------------------------------------------------------
// runImport
// ---------------------------------------------------------------------------
describe('runImport', () => {
  // Group 1
  it('creates a new item and returns { created: true } with the deterministic id', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot());
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);

    const res = await svc().runImport({
      workspacePath: WS,
      providerId: 'github-issues',
      externalId: '42',
    });

    expect(res).toEqual({ id: importedItemId(URN), urn: URN, created: true });

    // fetchSnapshot got the right args
    expect(mockRegistry.fetchSnapshot).toHaveBeenCalledWith(WS, 'github-issues', '42');

    // handleTrackerCreate was called once with the mapped fields + origin
    expect(create).toHaveBeenCalledTimes(1);
    const [createArgs, wsArg] = create.mock.calls[0];
    expect(wsArg).toBe(WS);
    expect(createArgs.id).toBe(importedItemId(URN));
    expect(createArgs.type).toBe('bug');
    expect(createArgs.title).toBe('Upstream title');
    expect(createArgs.description).toBe('Upstream body');
    expect(createArgs.status).toBe('to-do'); // 'open' -> 'to-do'
    expect(createArgs.priority).toBe('high');
    expect(createArgs.labels).toEqual(['bug', 'p1']);
    expect(createArgs.createdByAgent).toBe(false);
    expect(createArgs.origin.kind).toBe('external');
    expect(createArgs.origin.external.urn).toBe(URN);
    expect(createArgs.origin.external.bodyHash).toBe(hashBody('Upstream body'));
    expect(createArgs.origin.external.upstreamBodyChanged).toBe(false);
    expect(typeof createArgs.origin.external.importedAt).toBe('string');
    expect(typeof createArgs.origin.external.lastSyncedAt).toBe('string');
  });

  // Group 2
  it('returns the existing item ({ created: false }) and never calls create when the URN is already imported', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot());
    mockRegistry.findLocalIdByUrn.mockResolvedValue('existing-99');

    const res = await svc().runImport({
      workspacePath: WS,
      providerId: 'github-issues',
      externalId: '42',
    });

    expect(res).toEqual({ id: 'existing-99', urn: URN, created: false });
    expect(create).not.toHaveBeenCalled();
  });

  // Group 3
  it('recovers from a create race: re-checks the URN and returns the raced id without throwing', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot());
    mockRegistry.findLocalIdByUrn
      .mockResolvedValueOnce(null) // initial check: not present
      .mockResolvedValueOnce('raced-7'); // post-failure re-check: a synced copy appeared
    create.mockResolvedValue({ isError: true, content: [{ text: 'duplicate key' }] });

    const res = await svc().runImport({
      workspacePath: WS,
      providerId: 'github-issues',
      externalId: '42',
    });

    expect(res).toEqual({ id: 'raced-7', urn: URN, created: false });
    expect(mockRegistry.findLocalIdByUrn).toHaveBeenCalledTimes(2);
  });

  // Group 4
  it('throws (including the error text) when create fails and no raced row exists', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot());
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null); // both checks: still absent
    create.mockResolvedValue({ isError: true, content: [{ text: 'disk on fire' }] });

    await expect(
      svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' })
    ).rejects.toThrow('Import failed while creating tracker item: disk on fire');
  });

  // Group 5
  it('throws when the snapshot has no URN (before any lock / lookup)', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ external: { urn: '' } }));

    await expect(
      svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' })
    ).rejects.toThrow('Importer returned a snapshot with no URN');

    expect(mockRegistry.findLocalIdByUrn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  // Group 6
  it('back-fills titleSnapshot from snapshot.title when absent', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: 'My Title', external: { titleSnapshot: '' } })
    );
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);

    await svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' });

    const [createArgs] = create.mock.calls[0];
    expect(createArgs.origin.external.titleSnapshot).toBe('My Title');
  });

  it('back-fills titleSnapshot from the URN when both titleSnapshot and title are absent', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: '', external: { titleSnapshot: '' } })
    );
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);

    await svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' });

    const [createArgs] = create.mock.calls[0];
    expect(createArgs.origin.external.titleSnapshot).toBe(URN);
  });

  // Group 7
  it('type resolution: explicit primaryType arg wins over snapshot/contribution', async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ primaryType: 'bug' }));
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);
    mockRegistry.getContribution.mockResolvedValue({ importsAs: ['epic'] });

    await svc().runImport({
      workspacePath: WS,
      providerId: 'github-issues',
      externalId: '42',
      primaryType: 'task',
    });

    expect(create.mock.calls[0][0].type).toBe('task');
  });

  it("type resolution: falls back to snapshot.primaryType when no arg", async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ primaryType: 'feature' }));
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);
    mockRegistry.getContribution.mockResolvedValue({ importsAs: ['epic'] });

    await svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' });

    expect(create.mock.calls[0][0].type).toBe('feature');
  });

  it("type resolution: falls back to contribution.importsAs[0] when arg and snapshot type are absent", async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ primaryType: '' }));
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);
    mockRegistry.getContribution.mockResolvedValue({ importsAs: ['epic', 'story'] });

    await svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' });

    expect(create.mock.calls[0][0].type).toBe('epic');
  });

  it("type resolution: defaults to 'bug' when nothing else resolves", async () => {
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ primaryType: '' }));
    mockRegistry.findLocalIdByUrn.mockResolvedValue(null);
    mockRegistry.getContribution.mockResolvedValue(null);

    await svc().runImport({ workspacePath: WS, providerId: 'github-issues', externalId: '42' });

    expect(create.mock.calls[0][0].type).toBe('bug');
  });
});

// ---------------------------------------------------------------------------
// resnapshot
// ---------------------------------------------------------------------------
describe('resnapshot', () => {
  // Group 8
  it('applies the upstream title when the title is unchanged locally (titleUpdated: true)', async () => {
    queueLocalRow({ title: 'Old title', external: { titleSnapshot: 'Old title' } });
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: 'New title', status: 'open' })
    );

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.titleUpdated).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].title).toBe('New title');
  });

  it('does NOT apply the upstream title when the title was edited locally (titleUpdated: false)', async () => {
    queueLocalRow({ title: 'Edited locally', external: { titleSnapshot: 'Old title' } });
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: 'New title', status: 'open' })
    );

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.titleUpdated).toBe(false);
    expect('title' in update.mock.calls[0][0]).toBe(false);
  });

  // Group 9
  it('applies the upstream status when status is unchanged locally (statusUpdated: true)', async () => {
    // ext.stateSnapshot 'open' -> mapStatus 'to-do' == local 'to-do' => unchanged
    queueLocalRow({ status: 'to-do', external: { stateSnapshot: 'open' } });
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ status: 'closed' })); // -> 'done'

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.statusUpdated).toBe(true);
    expect(update.mock.calls[0][0].status).toBe('done');
  });

  it('does NOT apply the upstream status when status was changed locally (statusUpdated: false)', async () => {
    // local 'in-progress' != mapStatus('open')='to-do' => changed locally
    queueLocalRow({ status: 'in-progress', external: { stateSnapshot: 'open' } });
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ status: 'closed' }));

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.statusUpdated).toBe(false);
    expect('status' in update.mock.calls[0][0]).toBe(false);
  });

  // Group 10
  it('unions local + upstream labels (no dupes, local-only labels preserved)', async () => {
    queueLocalRow({ labels: ['local-only', 'shared'] });
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ labels: ['shared', 'upstream-only'], status: 'open' })
    );

    await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(update.mock.calls[0][0].labels).toEqual(['local-only', 'shared', 'upstream-only']);
  });

  // Group 11
  it('bodyChanged: true when a prior bodyHash exists and the new hash differs', async () => {
    queueLocalRow({ external: { bodyHash: hashBody('Old body') } });
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ body: 'Brand new body' }));

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.bodyChanged).toBe(true);
    // The refreshed external snapshot records the change flag + new hash.
    const ext = update.mock.calls[0][0].origin.external;
    expect(ext.upstreamBodyChanged).toBe(true);
    expect(ext.bodyHash).toBe(hashBody('Brand new body'));
  });

  it('bodyChanged: false when there is no prior bodyHash (even if the body differs)', async () => {
    queueLocalRow({ external: { bodyHash: undefined } });
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ body: 'Anything else' }));

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.bodyChanged).toBe(false);
    expect(update.mock.calls[0][0].origin.external.upstreamBodyChanged).toBe(false);
  });

  it('bodyChanged: false when the new body hash matches the stored hash', async () => {
    queueLocalRow({ external: { bodyHash: hashBody('Same body') } });
    mockRegistry.fetchSnapshot.mockResolvedValue(makeSnapshot({ body: 'Same body' }));

    const res = await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(res.bodyChanged).toBe(false);
  });

  it('always refreshes the stored external snapshot (titleSnapshot/stateSnapshot/bodyHash) and queries by [workspacePath, urn]', async () => {
    queueLocalRow({ external: { titleSnapshot: 'Old title', stateSnapshot: 'open' } });
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: 'Fresh', status: 'closed', body: 'fresh body' })
    );

    await svc().resnapshot({ workspacePath: WS, urn: URN });

    expect(mockDbQuery.mock.calls[0][1]).toEqual([WS, URN]);
    const ext = update.mock.calls[0][0].origin.external;
    expect(ext.titleSnapshot).toBe('Fresh');
    expect(ext.stateSnapshot).toBe('closed');
    expect(ext.bodyHash).toBe(hashBody('fresh body'));
    expect(typeof ext.lastSyncedAt).toBe('string');
  });

  it('throws when no local item backs the URN', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });

    await expect(svc().resnapshot({ workspacePath: WS, urn: URN })).rejects.toThrow(
      `No imported item found for URN ${URN}`
    );
    expect(mockRegistry.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('throws when the local item is not an external import', async () => {
    queueLocalRow({ external: null }); // origin.kind = 'native'

    await expect(svc().resnapshot({ workspacePath: WS, urn: URN })).rejects.toThrow(
      'is not an external import'
    );
  });
});

// ---------------------------------------------------------------------------
// applyUpstreamBody
// ---------------------------------------------------------------------------
describe('applyUpstreamBody', () => {
  // Group 12
  it('overwrites the description with the upstream body and clears upstreamBodyChanged', async () => {
    queueLocalRow({ external: { upstreamBodyChanged: true } });
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ title: 'T', status: 'open', body: 'Fresh upstream body' })
    );

    const res = await svc().applyUpstreamBody({ workspacePath: WS, urn: URN });

    expect(res).toEqual({ id: 'local-1' });
    const [updateArgs, wsArg] = update.mock.calls[0];
    expect(wsArg).toBe(WS);
    expect(updateArgs.id).toBe('local-1');
    expect(updateArgs.description).toBe('Fresh upstream body');
    expect(updateArgs.origin.external.upstreamBodyChanged).toBe(false);
    expect(updateArgs.origin.external.bodyHash).toBe(hashBody('Fresh upstream body'));
    expect(updateArgs.origin.external.titleSnapshot).toBe('T');
  });

  it('writes an empty-string description when the upstream body is undefined', async () => {
    queueLocalRow();
    mockRegistry.fetchSnapshot.mockResolvedValue(
      makeSnapshot({ status: 'open', body: undefined })
    );

    await svc().applyUpstreamBody({ workspacePath: WS, urn: URN });

    expect(update.mock.calls[0][0].description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// dismissUpstreamBodyChange
// ---------------------------------------------------------------------------
describe('dismissUpstreamBodyChange', () => {
  // Group 13
  it('clears the flag and issues an update with the new origin but no body/description change', async () => {
    queueLocalRow({ external: { upstreamBodyChanged: true, titleSnapshot: 'Kept title' } });

    const res = await svc().dismissUpstreamBodyChange({ workspacePath: WS, urn: URN });

    expect(res).toEqual({ id: 'local-1' });
    // Does NOT re-fetch from upstream — it just toggles the stored flag.
    expect(mockRegistry.fetchSnapshot).not.toHaveBeenCalled();

    expect(update).toHaveBeenCalledTimes(1);
    const [updateArgs, wsArg] = update.mock.calls[0];
    expect(wsArg).toBe(WS);
    expect(updateArgs.id).toBe('local-1');
    expect('description' in updateArgs).toBe(false);
    expect(updateArgs.origin.kind).toBe('external');
    expect(updateArgs.origin.external.upstreamBodyChanged).toBe(false);
    // Other stored external fields are preserved untouched.
    expect(updateArgs.origin.external.titleSnapshot).toBe('Kept title');
  });
});
