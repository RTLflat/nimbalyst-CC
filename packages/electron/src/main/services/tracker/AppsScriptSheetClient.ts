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
  return data.rows ?? [];
}
