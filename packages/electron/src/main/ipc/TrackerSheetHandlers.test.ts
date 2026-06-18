import { describe, it, expect, vi, beforeAll } from 'vitest';
import { normalizeWebAppUrl, registerTrackerSheetHandlers } from './TrackerSheetHandlers';
import * as store from '../utils/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const capturedHandlers: Record<string, (...args: any[]) => unknown> = {};

vi.mock('../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    capturedHandlers[channel] = fn;
  },
}));

vi.mock('../utils/store', () => ({
  getWorkspaceState: vi.fn(() => ({
    googleSheetIntegration: { webAppUrl: 'https://x.example.com/exec', accessToken: 'secret-token' },
  })),
  updateWorkspaceState: vi.fn(),
}));

vi.mock('../services/tracker/AppsScriptSheetClient', () => ({
  fetchRows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/tracker/TrackerSheetImportService', () => ({
  importFromSheet: vi.fn(),
}));

describe('normalizeWebAppUrl', () => {
  it('keeps a plain /exec url', () => {
    expect(normalizeWebAppUrl(' https://script.google.com/a/x/exec ')).toBe('https://script.google.com/a/x/exec');
  });
  it('strips a pasted query string', () => {
    expect(normalizeWebAppUrl('https://x/exec?api=rows&token=z')).toBe('https://x/exec');
  });
});

describe('tracker:sheet-get-config handler', () => {
  beforeAll(() => {
    registerTrackerSheetHandlers();
  });

  it('returns webAppUrl and omits accessToken', () => {
    const handler = capturedHandlers['tracker:sheet-get-config'];
    expect(handler).toBeDefined();
    const result = handler({} as never, '/workspace/path');
    expect(result).toHaveProperty('webAppUrl', 'https://x.example.com/exec');
    expect(result).not.toHaveProperty('accessToken');
  });

  it('returns null when no webAppUrl is configured', () => {
    vi.mocked(store.getWorkspaceState).mockReturnValueOnce({ googleSheetIntegration: undefined } as never);
    const handler = capturedHandlers['tracker:sheet-get-config'];
    const result = handler({} as never, '/workspace/path');
    expect(result).toBeNull();
  });
});
