import { safeHandle } from '../utils/ipcRegistry';
import { getWorkspaceState, updateWorkspaceState } from '../utils/store';
import { fetchRows } from '../services/tracker/AppsScriptSheetClient';
import { importFromSheet } from '../services/tracker/TrackerSheetImportService';

export function normalizeWebAppUrl(input: string): string {
  const trimmed = (input || '').trim();
  const q = trimmed.indexOf('?');
  return q === -1 ? trimmed : trimmed.slice(0, q);
}

export function registerTrackerSheetHandlers(): void {
  safeHandle('tracker:sheet-get-config', (_e, workspacePath: string) => {
    return getWorkspaceState(workspacePath).googleSheetIntegration ?? null;
  });

  safeHandle(
    'tracker:sheet-connect',
    async (_e, payload: { workspacePath: string; webAppUrl: string; accessToken?: string }) => {
      const webAppUrl = normalizeWebAppUrl(payload.webAppUrl);
      // Test fetch — throws if the URL/token is wrong; surfaces a clear error to the dialog.
      await fetchRows(webAppUrl, payload.accessToken);
      updateWorkspaceState(payload.workspacePath, (state) => {
        state.googleSheetIntegration = { webAppUrl, accessToken: payload.accessToken || undefined };
      });
      return { ok: true as const, formUrl: webAppUrl };
    },
  );

  safeHandle('tracker:sheet-import', async (_e, workspacePath: string) => importFromSheet(workspacePath));
}
