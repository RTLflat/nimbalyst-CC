import { createHash } from 'crypto';

export function deterministicTrackerId(sourceId: string, rowId: string): string {
  const hash = createHash('sha256').update(`google-sheets:${sourceId}:${rowId}`).digest('hex');
  return `gsheet-${hash.slice(0, 32)}`;
}

// Matches ExternalSourceRef (packages/runtime/src/core/DocumentService.ts): the
// renderer's source chip reads origin.external.providerId, so it MUST be set.
export function googleSheetsOrigin(webAppUrl: string, rowId: string, title: string) {
  const now = new Date().toISOString();
  return {
    kind: 'external' as const,
    external: {
      providerId: 'google-sheets',
      externalId: rowId,
      urn: `google-sheets://${rowId}`,
      url: webAppUrl,
      titleSnapshot: title,
      importedAt: now,
      lastSyncedAt: now,
    },
  };
}
