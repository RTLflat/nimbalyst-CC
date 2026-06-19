// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSheetImport } from '../useSheetImport';

beforeEach(() => {
  (window as any).electronAPI = {
    trackerSheets: {
      getConfig: vi.fn(async () => ({ webAppUrl: 'https://x/exec' })),
      import: vi.fn(async () => ({ created: 2, skipped: 1, alreadyImported: 0, errors: [] })),
    },
  };
});

describe('useSheetImport', () => {
  it('imports when connected and records the result', async () => {
    const { result } = renderHook(() => useSheetImport('/ws'));
    await act(async () => { await result.current.runImport(); });
    expect((window as any).electronAPI.trackerSheets.import).toHaveBeenCalledWith('/ws');
    expect(result.current.lastResult?.created).toBe(2);
  });

  it('opens the connect dialog when not connected', async () => {
    (window as any).electronAPI.trackerSheets.getConfig = vi.fn(async () => null);
    const open = vi.fn();
    const { result } = renderHook(() => useSheetImport('/ws', open));
    await act(async () => { await result.current.runImport(); });
    expect(open).toHaveBeenCalled();
    expect((window as any).electronAPI.trackerSheets.import).not.toHaveBeenCalled();
  });
});
