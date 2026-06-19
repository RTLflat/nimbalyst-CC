import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') });

// Per-worker re-export of the Node-ABI better-sqlite3 binary that
// vitest.globalSetup.ts cached. Worker processes don't inherit globalSetup
// env mutations, so we read it from the disk cache the global setup wrote.
if (!process.env.NIMBALYST_BETTER_SQLITE3_NATIVE) {
  const cached = path.join(
    __dirname,
    'node_modules',
    '.cache',
    'nimbalyst-better-sqlite3-node',
    'binary-path.txt',
  );
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, 'utf-8').trim();
    if (p && fs.existsSync(p)) {
      process.env.NIMBALYST_BETTER_SQLITE3_NATIVE = p;
    }
  }
}

// Mock electron for tests that import it
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    // Lifecycle event registration: several main-process modules call
    // `app.on('before-quit', ...)` at import time (e.g. WindowManager via
    // WorkspaceWatcher). Stub the EventEmitter-style surface so importing them
    // under test doesn't throw "app.on is not a function".
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    isReady: vi.fn(() => true)
  },
  ipcRenderer: {
    send: vi.fn(),
    on: vi.fn(),
    invoke: vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

// electron-store@11 (via conf@15) dropped the package.json `projectName`
// fallback: `new Store({ name })` throws "Please specify the `projectName`
// option" whenever Electron's `app` is unresolvable. Under vitest that is
// always -- the `vi.mock('electron')` above does not reach electron-store's own
// `import electron from 'electron'` (node_modules is not transformed), so its
// `defaultCwd` stays undefined. The real main process is unaffected (it sets
// cwd = app.getPath('userData'), so conf never consults projectName). Inject the
// same name electron-store@8 fell back to ('electron-store') so the no-app config
// dir matches what tests expect: envPaths('electron-store', { suffix: 'nodejs' }).
// A per-file vi.mock('electron-store') still overrides this (e.g. CommitTrackerLinker).
vi.mock('electron-store', async () => {
  const actual = await vi.importActual<any>('electron-store');
  const RealStore = actual.default;
  return {
    default: class extends RealStore {
      constructor(options: Record<string, unknown> = {}) {
        super({ projectName: 'electron-store', ...options });
      }
    },
  };
});

// Set test timeout
beforeAll(() => {
  vi.setConfig({ testTimeout: 10000 });
});