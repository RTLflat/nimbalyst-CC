/**
 * Google Sheets importer — pure mapping (SheetRow -> ImporterListEntry / TrackerSnapshot).
 *
 * Dependency-free on purpose (only type-only imports from the extension SDK and a
 * const array), so it unit-tests and type-checks in isolation without dragging in
 * the Electron `app` chain — the same rationale as `importedItemId.ts`.
 *
 * Spike for plan 014 (Google Sheets importer unification). See
 * `docs/superpowers/specs/2026-06-18-google-sheets-importer-unification-design.md`.
 */

import type {
  ImporterListEntry,
  TrackerImporterContribution,
  TrackerSnapshot,
} from '@nimbalyst/extension-sdk';
import { CREATABLE_TRACKER_TYPES } from './creatableTypes';

export const GOOGLE_SHEETS_PROVIDER_ID = 'google-sheets';
/** URN scheme — MUST match the legacy `googleSheetsOrigin` so URN dedup is shared. */
export const GOOGLE_SHEETS_URN_SCHEME = 'google-sheets';

/** Structural subset of `SheetRow` (from AppsScriptSheetClient) the mapping needs. */
export interface SheetRowLike {
  rowId: string;
  type: string;
  title: string;
  commandFeature: string;
  description: string;
}

/**
 * The contribution the built-in importer advertises. Mirrors the manifest shape a
 * bundled extension would declare; `backendModuleId` is a sentinel because a
 * built-in importer runs host-side (no utility-process backend).
 */
export const GOOGLE_SHEETS_CONTRIBUTION: TrackerImporterContribution = {
  id: GOOGLE_SHEETS_PROVIDER_ID,
  displayName: 'Google Sheet',
  icon: 'table_chart',
  urnScheme: GOOGLE_SHEETS_URN_SCHEME,
  backendModuleId: '(built-in)',
  importsAs: [...CREATABLE_TRACKER_TYPES],
};

/** Stable URN for a sheet row — identical to the legacy origin URN. */
export function buildSheetUrn(rowId: string): string {
  return `${GOOGLE_SHEETS_URN_SCHEME}://${rowId}`;
}

/**
 * Compose the tracker body: prepend the affected command/feature hint when set,
 * then the description. Byte-identical to the legacy `composeBody`.
 */
export function composeSheetBody(commandFeature: string, description: string): string {
  const cf = (commandFeature ?? '').trim();
  const body = description ?? '';
  return cf ? `**Affected command / feature:** ${cf}\n\n${body}` : body;
}

/** Sheet rows carry no upstream state; surface a constant so the UI filter is sane. */
const SHEET_ROW_STATE = 'open';
/** No per-row mtime exists in the current sheet contract. */
const SYNTHETIC_UPDATED_AT = new Date(0).toISOString();

/** SheetRow -> lightweight list entry (the `list` RPC). */
export function sheetRowToListEntry(row: SheetRowLike, webAppUrl: string): ImporterListEntry {
  return {
    externalId: row.rowId,
    urn: buildSheetUrn(row.rowId),
    url: webAppUrl,
    title: row.title,
    state: SHEET_ROW_STATE,
    updatedAt: SYNTHETIC_UPDATED_AT,
  };
}

/** SheetRow -> one-shot snapshot (the `fetch` RPC). */
export function sheetRowToSnapshot(row: SheetRowLike, webAppUrl: string): TrackerSnapshot {
  return {
    external: {
      providerId: GOOGLE_SHEETS_PROVIDER_ID,
      externalId: row.rowId,
      urn: buildSheetUrn(row.rowId),
      url: webAppUrl,
      titleSnapshot: row.title,
    },
    primaryType: row.type,
    title: row.title,
    body: composeSheetBody(row.commandFeature, row.description),
  };
}

/** A row is importable when it has an id, a creatable type, and a non-empty title. */
export function isImportableRow(row: SheetRowLike): boolean {
  return Boolean(
    row.rowId &&
      CREATABLE_TRACKER_TYPES.includes(row.type as (typeof CREATABLE_TRACKER_TYPES)[number]) &&
      row.title?.trim()
  );
}
