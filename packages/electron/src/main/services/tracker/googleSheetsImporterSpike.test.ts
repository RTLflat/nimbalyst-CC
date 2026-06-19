// Spike test (plan 014): prove one Google Sheet row imports through the SHARED
// TrackerImportService.runImport pipeline and is idempotent on re-run (URN dedup),
// including recognizing a legacy `gsheet-*` row by its URN.
//
// Mocking mirrors TrackerImportService.test.ts: the registry is mocked, but its
// `fetchSnapshot` delegates to the REAL Google Sheets importer mapping so the
// SheetRow -> TrackerSnapshot transform is exercised end-to-end through runImport.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRegistry, mockDbQuery, urnToLocalId } = vi.hoisted(() => ({
  mockRegistry: {
    fetchSnapshot: vi.fn(),
    findLocalIdByUrn: vi.fn(),
    getContribution: vi.fn(),
  },
  mockDbQuery: vi.fn(),
  urnToLocalId: new Map<string, string>(),
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
import { handleTrackerCreate } from '../../mcp/tools/trackerToolHandlers';
import {
  GOOGLE_SHEETS_CONTRIBUTION,
  GOOGLE_SHEETS_PROVIDER_ID,
  buildSheetUrn,
  sheetRowToSnapshot,
  type SheetRowLike,
} from './googleSheetsImporterMapping';

const create = handleTrackerCreate as unknown as ReturnType<typeof vi.fn>;

const WS = '/ws';
const WEBAPP = 'https://script.google.com/macros/s/abc/exec';
const ROW: SheetRowLike = {
  rowId: 'row-1',
  type: 'bug',
  title: 'Crash on save',
  commandFeature: 'Save',
  description: 'It crashes when I save.',
};
const URN = buildSheetUrn(ROW.rowId);

const svc = () => getTrackerImportService();

beforeEach(() => {
  vi.clearAllMocks();
  urnToLocalId.clear();

  // fetchSnapshot runs the REAL importer mapping for the fixture row.
  mockRegistry.fetchSnapshot.mockImplementation(
    async (_ws: string, _provider: string, externalId: string) => {
      if (externalId !== ROW.rowId) throw new Error(`Sheet row ${externalId} not found`);
      return sheetRowToSnapshot(ROW, WEBAPP);
    }
  );
  // URN dedup backed by an in-memory index that create() populates.
  mockRegistry.findLocalIdByUrn.mockImplementation(
    async (_ws: string, urn: string) => urnToLocalId.get(urn) ?? null
  );
  mockRegistry.getContribution.mockResolvedValue(GOOGLE_SHEETS_CONTRIBUTION);

  create.mockImplementation(async (args: any) => {
    urnToLocalId.set(args.origin.external.urn, args.id);
    return { isError: false };
  });
});

describe('Google Sheets registry import spike', () => {
  it('imports one row through runImport with the right origin URN, type, and body', async () => {
    const res = await svc().runImport({
      workspacePath: WS,
      providerId: GOOGLE_SHEETS_PROVIDER_ID,
      externalId: ROW.rowId,
    });

    expect(res).toEqual({ id: importedItemId(URN), urn: URN, created: true });
    expect(mockRegistry.fetchSnapshot).toHaveBeenCalledWith(WS, 'google-sheets', 'row-1');

    expect(create).toHaveBeenCalledTimes(1);
    const [createArgs, wsArg] = create.mock.calls[0];
    expect(wsArg).toBe(WS);
    expect(createArgs.id).toBe(importedItemId(URN));
    expect(createArgs.type).toBe('bug'); // row.type drives the tracker type
    expect(createArgs.title).toBe('Crash on save');
    expect(createArgs.description).toBe(
      '**Affected command / feature:** Save\n\nIt crashes when I save.'
    );
    expect(createArgs.origin.kind).toBe('external');
    expect(createArgs.origin.external.urn).toBe(URN);
    expect(createArgs.origin.external.providerId).toBe('google-sheets');
  });

  it('is idempotent: a second runImport of the same URN returns { created: false } and never re-creates', async () => {
    const first = await svc().runImport({
      workspacePath: WS,
      providerId: GOOGLE_SHEETS_PROVIDER_ID,
      externalId: ROW.rowId,
    });
    expect(first.created).toBe(true);

    const second = await svc().runImport({
      workspacePath: WS,
      providerId: GOOGLE_SHEETS_PROVIDER_ID,
      externalId: ROW.rowId,
    });

    expect(second).toEqual({ id: importedItemId(URN), urn: URN, created: false });
    expect(create).toHaveBeenCalledTimes(1); // only the first import created a row
  });

  it('dedups against a pre-existing legacy gsheet-* row found by the shared URN', async () => {
    // Simulate a row imported earlier via the legacy path: different id, same URN.
    urnToLocalId.set(URN, 'gsheet-deadbeefdeadbeefdeadbeefdeadbeef');

    const res = await svc().runImport({
      workspacePath: WS,
      providerId: GOOGLE_SHEETS_PROVIDER_ID,
      externalId: ROW.rowId,
    });

    expect(res).toEqual({
      id: 'gsheet-deadbeefdeadbeefdeadbeefdeadbeef',
      urn: URN,
      created: false,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
