import { useState } from 'react';

interface Props {
  workspacePath: string;
  onClose: () => void;
}

export function ConnectGoogleSheetDialog({ workspacePath, onClose }: Props) {
  const [webAppUrl, setWebAppUrl] = useState('');
  const [token, setToken] = useState('');
  const [phase, setPhase] = useState<'input' | 'connecting' | 'done'>('input');
  const [error, setError] = useState('');
  const [formUrl, setFormUrl] = useState('');

  async function connect() {
    setPhase('connecting');
    setError('');
    try {
      const r = await window.electronAPI.trackerSheets.connect(workspacePath, webAppUrl, token);
      setFormUrl(r.formUrl);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setPhase('input');
    }
  }

  return (
    <div className="connect-google-sheet-dialog bg-[var(--nim-bg)] text-[var(--nim-text)] p-4 rounded">
      <h2 className="text-base font-semibold mb-2">Connect Google Sheet</h2>
      {phase !== 'done' && (
        <>
          <p className="text-sm text-[var(--nim-text-faint)] mb-3">
            Deploy the tracker-intake Apps Script to your sheet (Extensions &rarr; Apps Script &rarr; Deploy &rarr; Web
            app), then paste the Web app URL (ends in <code>/exec</code>).
          </p>
          <label className="block text-sm mb-1" htmlFor="web-app-url">
            Web app URL
          </label>
          <input
            id="web-app-url"
            className="nim-input w-full"
            value={webAppUrl}
            onChange={(e) => setWebAppUrl(e.target.value)}
            placeholder="https://script.google.com/.../exec"
          />
          <label className="block text-sm mb-1 mt-3" htmlFor="access-token">
            Access token (optional)
          </label>
          <input
            id="access-token"
            className="nim-input w-full"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {error && <p className="text-[var(--nim-danger)] text-sm mt-2">{error}</p>}
          <div className="flex gap-2 justify-end mt-4">
            <button className="nim-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="nim-btn-primary"
              disabled={!webAppUrl || phase === 'connecting'}
              onClick={connect}
            >
              {phase === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </>
      )}
      {phase === 'done' && (
        <div className="text-sm">
          <p className="mb-1">Connected. Share this form link with contributors:</p>
          <div className="flex gap-2 items-center">
            <code className="select-text break-all">{formUrl}</code>
            <button className="nim-btn-secondary" onClick={() => navigator.clipboard.writeText(formUrl)}>
              Copy
            </button>
          </div>
          <div className="flex justify-end mt-4">
            <button className="nim-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
