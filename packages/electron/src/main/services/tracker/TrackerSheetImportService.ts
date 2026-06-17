import { handleTrackerCreate } from '../../mcp/tools/trackerToolHandlers';
import { fetchRows } from './AppsScriptSheetClient';
import { deterministicTrackerId, googleSheetsOrigin } from './sheetRowId';
import { CREATABLE_TRACKER_TYPES } from './creatableTypes';
import { trackerExists } from './trackerExists';
import { getWorkspaceState } from '../../utils/store';

export interface SheetImportResult {
  created: number;
  skipped: number;
  alreadyImported: number;
  errors: Array<{ rowId: string; reason: string }>;
}

export function composeBody(commandFeature: string, description: string): string {
  const cf = (commandFeature ?? '').trim();
  const body = description ?? '';
  return cf ? `**Affected command / feature:** ${cf}\n\n${body}` : body;
}

export async function importFromSheet(workspacePath: string): Promise<SheetImportResult> {
  const cfg = getWorkspaceState(workspacePath).googleSheetIntegration;
  if (!cfg?.webAppUrl) throw new Error('No Google Sheet connected for this workspace');

  const rows = await fetchRows(cfg.webAppUrl, cfg.accessToken);
  const result: SheetImportResult = { created: 0, skipped: 0, alreadyImported: 0, errors: [] };

  for (const row of rows) {
    if (!row.rowId) {
      result.skipped++;
      result.errors.push({ rowId: '(blank)', reason: 'Missing RowId' });
      continue;
    }
    if (!CREATABLE_TRACKER_TYPES.includes(row.type as (typeof CREATABLE_TRACKER_TYPES)[number])) {
      result.skipped++;
      result.errors.push({ rowId: row.rowId, reason: `Unknown type "${row.type}"` });
      continue;
    }
    if (!row.title.trim()) {
      result.skipped++;
      result.errors.push({ rowId: row.rowId, reason: 'Missing title' });
      continue;
    }

    const id = deterministicTrackerId(cfg.webAppUrl, row.rowId);
    if (await trackerExists(id)) {
      result.alreadyImported++;
      continue;
    }

    const res = await handleTrackerCreate(
      {
        id,
        type: row.type,
        title: row.title.trim(),
        description: composeBody(row.commandFeature, row.description),
        origin: googleSheetsOrigin(cfg.webAppUrl, row.rowId),
      } as any,
      workspacePath,
    );
    if (res.isError) {
      result.skipped++;
      result.errors.push({ rowId: row.rowId, reason: 'Create failed' });
      continue;
    }
    result.created++;
  }
  return result;
}
