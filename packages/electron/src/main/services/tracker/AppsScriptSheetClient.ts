/** Hard cap on rows accepted from one sheet import. A legitimate intake sheet
 *  is far smaller; this stops a compromised endpoint from flooding the DB. */
const MAX_ROWS = 2000;
/** Per-field character caps (title is a single line; description is a body). */
const MAX_TITLE_LEN = 500;
const MAX_DESCRIPTION_LEN = 64_000;
const MAX_COMMAND_FEATURE_LEN = 500;

function clamp(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : value == null ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

export interface SheetRow {
  rowId: string;
  type: string;
  title: string;
  commandFeature: string;
  description: string;
}

export async function fetchRows(webAppUrl: string, accessToken?: string): Promise<SheetRow[]> {
  const sep = webAppUrl.includes('?') ? '&' : '?';
  const url = `${webAppUrl}${sep}api=rows${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status})`);
  const data = (await res.json().catch(() => {
    throw new Error('Sheet endpoint did not return JSON — check the deployed Apps Script URL');
  })) as { rows?: SheetRow[]; error?: string };
  if (data.error) throw new Error(`Sheet endpoint error: ${data.error}`);
  const rows = data.rows ?? [];
  if (rows.length > MAX_ROWS) {
    throw new Error(`Sheet returned ${rows.length} rows, exceeding the ${MAX_ROWS}-row import limit.`);
  }
  return rows.map((r) => ({
    rowId: clamp(r.rowId, 200),
    type: clamp(r.type, 100),
    title: clamp(r.title, MAX_TITLE_LEN),
    commandFeature: clamp(r.commandFeature, MAX_COMMAND_FEATURE_LEN),
    description: clamp(r.description, MAX_DESCRIPTION_LEN),
  }));
}
