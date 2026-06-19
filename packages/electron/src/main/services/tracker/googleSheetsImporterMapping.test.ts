// Unit tests for the Google Sheets importer's pure mapping (plan 014 spike).
// Modeled on github-issues-importer/src/__tests__/backend.test.ts: assert the
// SheetRow -> ImporterListEntry / TrackerSnapshot mapping, with no Electron deps.

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SHEETS_CONTRIBUTION,
  GOOGLE_SHEETS_PROVIDER_ID,
  buildSheetUrn,
  composeSheetBody,
  isImportableRow,
  sheetRowToListEntry,
  sheetRowToSnapshot,
  type SheetRowLike,
} from './googleSheetsImporterMapping';

const WEBAPP = 'https://script.google.com/macros/s/abc/exec';

function row(overrides: Partial<SheetRowLike> = {}): SheetRowLike {
  return {
    rowId: 'row-1',
    type: 'bug',
    title: 'Crash on save',
    commandFeature: 'Save',
    description: 'It crashes when I save.',
    ...overrides,
  };
}

describe('buildSheetUrn', () => {
  it('matches the legacy google-sheets origin URN form', () => {
    expect(buildSheetUrn('row-1')).toBe('google-sheets://row-1');
  });
});

describe('composeSheetBody', () => {
  it('prepends the affected command/feature when set', () => {
    expect(composeSheetBody('Save', 'desc')).toBe(
      '**Affected command / feature:** Save\n\ndesc'
    );
  });

  it('returns the description alone when command/feature is blank', () => {
    expect(composeSheetBody('   ', 'desc')).toBe('desc');
    expect(composeSheetBody('', 'desc')).toBe('desc');
  });
});

describe('isImportableRow', () => {
  it('accepts a creatable type with id + title', () => {
    expect(isImportableRow(row())).toBe(true);
  });

  it('rejects missing id, non-creatable type, or empty title', () => {
    expect(isImportableRow(row({ rowId: '' }))).toBe(false);
    expect(isImportableRow(row({ type: 'epic' }))).toBe(false);
    expect(isImportableRow(row({ title: '   ' }))).toBe(false);
  });
});

describe('sheetRowToListEntry', () => {
  it('maps a row to a list entry with the shared URN', () => {
    const entry = sheetRowToListEntry(row(), WEBAPP);
    expect(entry).toEqual({
      externalId: 'row-1',
      urn: 'google-sheets://row-1',
      url: WEBAPP,
      title: 'Crash on save',
      state: 'open',
      updatedAt: new Date(0).toISOString(),
    });
  });
});

describe('sheetRowToSnapshot', () => {
  it('maps a row to a snapshot with origin URN, type, and composed body', () => {
    const snap = sheetRowToSnapshot(row(), WEBAPP);
    expect(snap.external.providerId).toBe(GOOGLE_SHEETS_PROVIDER_ID);
    expect(snap.external.externalId).toBe('row-1');
    expect(snap.external.urn).toBe('google-sheets://row-1');
    expect(snap.external.url).toBe(WEBAPP);
    expect(snap.external.titleSnapshot).toBe('Crash on save');
    expect(snap.primaryType).toBe('bug'); // row.type drives the created tracker type
    expect(snap.title).toBe('Crash on save');
    expect(snap.body).toBe('**Affected command / feature:** Save\n\nIt crashes when I save.');
    // Sheets carry no upstream state/labels/priority.
    expect(snap.status).toBeUndefined();
    expect(snap.labels).toBeUndefined();
  });
});

describe('GOOGLE_SHEETS_CONTRIBUTION', () => {
  it('advertises the google-sheets provider + urn scheme and creatable types', () => {
    expect(GOOGLE_SHEETS_CONTRIBUTION.id).toBe('google-sheets');
    expect(GOOGLE_SHEETS_CONTRIBUTION.urnScheme).toBe('google-sheets');
    expect(GOOGLE_SHEETS_CONTRIBUTION.importsAs).toContain('bug');
    expect(GOOGLE_SHEETS_CONTRIBUTION.importsAs).toContain('task');
  });
});
