import { describe, it, expect, vi, beforeAll } from 'vitest';
import { normalizeWebAppUrl, registerTrackerSheetHandlers } from './TrackerSheetHandlers';
import * as store from '../utils/store';
import type { WorkspaceState } from '../utils/store';

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

// Simulate the keychain-available path: encryptSheetToken returns ciphertext
// (enc) and no plaintext. The crypto module's fallback behavior is unit-tested
// in sheetTokenCrypto.test.ts.
vi.mock('../services/tracker/sheetTokenCrypto', () => ({
  encryptSheetToken: vi.fn((token: string) => (token ? { enc: `ENC(${token})` } : {})),
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

describe('tracker:sheet-connect handler', () => {
  beforeAll(() => {
    registerTrackerSheetHandlers();
  });

  it('stores the encrypted token (accessTokenEnc), never plaintext accessToken', async () => {
    vi.mocked(store.updateWorkspaceState).mockClear();
    const handler = capturedHandlers['tracker:sheet-connect'];
    expect(handler).toBeDefined();

    await handler({} as never, {
      workspacePath: '/workspace/path',
      webAppUrl: 'https://x.example.com/exec',
      accessToken: 'secret-token',
    });

    // updateWorkspaceState(workspacePath, updater) — run the updater against a
    // bare state object to inspect what the handler writes.
    const call = vi.mocked(store.updateWorkspaceState).mock.calls.at(-1);
    expect(call?.[0]).toBe('/workspace/path');
    const updater = call?.[1];
    expect(updater).toBeDefined();
    const state = {} as WorkspaceState;
    updater?.(state);

    expect(state.googleSheetIntegration?.webAppUrl).toBe('https://x.example.com/exec');
    expect(state.googleSheetIntegration?.accessTokenEnc).toBe('ENC(secret-token)');
    expect(state.googleSheetIntegration?.accessToken).toBeUndefined();
  });
});
