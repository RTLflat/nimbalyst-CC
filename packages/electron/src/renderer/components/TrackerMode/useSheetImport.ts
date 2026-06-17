import { useCallback, useEffect, useState } from 'react';

interface SheetImportResult {
  created: number;
  skipped: number;
  alreadyImported: number;
  errors: Array<{ rowId: string; reason: string }>;
}

export function useSheetImport(workspacePath: string, openConnectDialog?: () => void) {
  const [connected, setConnected] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<SheetImportResult | null>(null);

  useEffect(() => {
    let alive = true;
    window.electronAPI.trackerSheets.getConfig(workspacePath)
      .then((cfg) => { if (alive) setConnected(Boolean(cfg?.webAppUrl)); })
      .catch(() => { if (alive) setConnected(false); });
    return () => { alive = false; };
  }, [workspacePath]);

  const runImport = useCallback(async () => {
    const cfg = await window.electronAPI.trackerSheets.getConfig(workspacePath);
    if (!cfg?.webAppUrl) { openConnectDialog?.(); return; }
    setImporting(true);
    try {
      const result = await window.electronAPI.trackerSheets.import(workspacePath);
      setLastResult(result);
    } finally {
      setImporting(false);
    }
  }, [workspacePath, openConnectDialog]);

  return { runImport, importing, lastResult, connected };
}
