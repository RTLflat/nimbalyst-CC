import { createHash } from 'crypto';

export function deterministicTrackerId(sourceId: string, rowId: string): string {
  const hash = createHash('sha256').update(`google-sheets:${sourceId}:${rowId}`).digest('hex');
  return `gsheet-${hash.slice(0, 32)}`;
}

export function googleSheetsOrigin(webAppUrl: string, rowId: string) {
  return { kind: 'external' as const, external: { source: 'google-sheets' as const, webAppUrl, rowId } };
}
