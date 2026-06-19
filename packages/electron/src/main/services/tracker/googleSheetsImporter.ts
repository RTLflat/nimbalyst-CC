/**
 * Google Sheets importer — built-in (host-side) implementation of the
 * `ImporterMethods` RPC surface.
 *
 * Unlike the GitHub importer (a utility-process backend module that shells out to
 * `gh`), Google Sheets' secret lives in Nimbalyst's own encrypted store. A
 * utility-process backend cannot read electron-store or call `safeStorage`, so this
 * importer runs **host-side** and reuses `decryptSheetToken` + `getWorkspaceState`
 * exactly as the legacy path. No token ever crosses the backend-module boundary.
 *
 * Spike for plan 014 — flag-gated via `builtInImporters.ts`. The legacy
 * `TrackerSheetImportService` path stays the default and is untouched. See
 * `docs/superpowers/specs/2026-06-18-google-sheets-importer-unification-design.md`.
 */

import type {
  ImporterBinding,
  ImporterListFilter,
  ImporterListPage,
  ImporterMethods,
  TrackerSnapshot,
} from '@nimbalyst/extension-sdk';
import { fetchRows } from './AppsScriptSheetClient';
import { decryptSheetToken } from './sheetTokenCrypto';
import { getWorkspaceState } from '../../utils/store';
import { logger } from '../../utils/logger';
import {
  GOOGLE_SHEETS_PROVIDER_ID,
  isImportableRow,
  sheetRowToListEntry,
  sheetRowToSnapshot,
} from './googleSheetsImporterMapping';

/** The single binding for a workspace: its connected sheet. */
const SHEET_BINDING_LABEL = 'Google Sheet';

/** Read the connected sheet config for a workspace, or null when none is connected. */
function getConfig(workspacePath: string): { webAppUrl: string; token?: string } | null {
  const cfg = getWorkspaceState(workspacePath).googleSheetIntegration;
  if (!cfg?.webAppUrl) return null;
  return { webAppUrl: cfg.webAppUrl, token: decryptSheetToken(cfg) };
}

/**
 * Build the host-side `ImporterMethods` bound to one workspace. Mirrors the
 * `activate(ctx).methods` shape a backend module returns, but runs in main.
 */
export function createGoogleSheetsBuiltInImporter(workspacePath: string): ImporterMethods {
  return {
    isAuthenticated: async (): Promise<boolean> => {
      // "Connected" is the auth signal — the web-app URL being configured.
      return Boolean(getConfig(workspacePath));
    },

    listBindings: async (): Promise<ImporterBinding[]> => {
      const cfg = getConfig(workspacePath);
      if (!cfg) return [];
      return [{ id: cfg.webAppUrl, label: SHEET_BINDING_LABEL }];
    },

    list: async (args: {
      binding: ImporterBinding;
      filters: ImporterListFilter;
    }): Promise<ImporterListPage> => {
      const cfg = getConfig(workspacePath);
      if (!cfg) throw new Error('No Google Sheet connected for this workspace');
      const rows = await fetchRows(cfg.webAppUrl, cfg.token);
      const filters = args.filters ?? {};
      let entries = rows
        .filter(isImportableRow)
        .map((row) => sheetRowToListEntry(row, cfg.webAppUrl));
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        entries = entries.filter(
          (e) => e.title.toLowerCase().includes(needle) || e.externalId.includes(needle)
        );
      }
      // The Apps Script endpoint returns all rows in one shot — no pagination.
      return { items: entries };
    },

    fetch: async (args: { externalId: string }): Promise<TrackerSnapshot> => {
      const cfg = getConfig(workspacePath);
      if (!cfg) throw new Error('No Google Sheet connected for this workspace');
      // No per-row endpoint in the Apps Script contract: re-pull all rows and
      // select by rowId. Documented spike inefficiency (production could cache list).
      const rows = await fetchRows(cfg.webAppUrl, cfg.token);
      const row = rows.find((r) => r.rowId === args.externalId);
      if (!row) {
        throw new Error(`Sheet row ${args.externalId} not found`);
      }
      logger.main.info(
        `[googleSheetsImporter] fetched row ${args.externalId} for ${GOOGLE_SHEETS_PROVIDER_ID}`
      );
      return sheetRowToSnapshot(row, cfg.webAppUrl);
    },
  };
}
