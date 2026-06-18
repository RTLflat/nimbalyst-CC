import { handleTrackerCreate } from '../../mcp/tools/trackerToolHandlers';
import { fetchRows } from './AppsScriptSheetClient';
import { deterministicTrackerId, googleSheetsOrigin } from './sheetRowId';
import { CREATABLE_TRACKER_TYPES } from './creatableTypes';
import { findExistingTrackerIds } from './trackerExists';
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

/** Pull a human-readable failure reason out of a tracker tool result. */
export function extractCreateFailureReason(res: {
  content?: Array<{ text?: string }>;
}): string {
  const text = res.content?.[0]?.text;
  if (!text) return 'Create failed (no detail)';
  // Schema-validation failures return JSON with a `summary` field; create
  // errors return a plain string. Try JSON first, fall back to the raw text.
  try {
    const parsed = JSON.parse(text) as { summary?: string };
    if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return parsed.summary.trim();
    }
  } catch {
    // not JSON — fall through
  }
  return text.trim();
}

export async function importFromSheet(workspacePath: string): Promise<SheetImportResult> {
  const cfg = getWorkspaceState(workspacePath).googleSheetIntegration;
  if (!cfg?.webAppUrl) throw new Error('No Google Sheet connected for this workspace');

  const rows = await fetchRows(cfg.webAppUrl, cfg.accessToken);
  const result: SheetImportResult = { created: 0, skipped: 0, alreadyImported: 0, errors: [] };

  const candidateIds = rows
    .filter(
      (r) =>
        r.rowId &&
        CREATABLE_TRACKER_TYPES.includes(r.type as (typeof CREATABLE_TRACKER_TYPES)[number]) &&
        r.title?.trim(),
    )
    .map((r) => deterministicTrackerId(cfg.webAppUrl, r.rowId));
  const existingIds = await findExistingTrackerIds(candidateIds);

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
    if (existingIds.has(id)) {
      result.alreadyImported++;
      continue;
    }

    const res = await handleTrackerCreate(
      {
        id,
        type: row.type,
        title: row.title.trim(),
        description: composeBody(row.commandFeature, row.description),
        origin: googleSheetsOrigin(cfg.webAppUrl, row.rowId, row.title.trim()),
      } as any,
      workspacePath,
    );
    if (res.isError) {
      // skipped counts both validation rejections (above) and create failures (here);
      // the specific reason is recorded in errors[].
      result.skipped++;
      result.errors.push({ rowId: row.rowId, reason: extractCreateFailureReason(res) });
      continue;
    }
    result.created++;
  }
  return result;
}
