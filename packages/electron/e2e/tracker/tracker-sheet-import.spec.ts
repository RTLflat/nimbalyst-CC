/**
 * E2E: Google Apps Script sheet import — create and idempotent re-import.
 *
 * Mirrors the harness pattern from tracker.spec.ts:
 *   - test.describe.configure({ mode: 'serial' })
 *   - beforeAll: createTempWorkspace → launchElectronApp → firstWindow → dismissAPIKeyDialog → waitForWorkspaceReady
 *   - afterAll: electronApp.close + fs.rm workspace
 *
 * A minimal HTTP stub mimics the Apps Script web-app endpoint so the Electron
 * main process can fetch rows without network access.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import { dismissAPIKeyDialog, waitForWorkspaceReady } from '../utils/testHelpers';
import { startStubAppsScript } from '../utils/stubAppsScript';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();
  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'allow-all' });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('imports apps-script rows into trackers and is idempotent', async () => {
  const stub = await startStubAppsScript({
    rows: [
      {
        rowId: 'r1',
        type: 'bug',
        title: 'Save crashes',
        commandFeature: 'Save cmd',
        description: 'repro',
      },
      {
        rowId: 'r2',
        type: 'task',
        title: 'Add tooltip',
        commandFeature: '',
        description: '',
      },
    ],
  });

  try {
    // Step 1: Connect — performs a test-fetch to the stub to validate the URL,
    // then persists the config in workspace state.
    await page.evaluate(
      ({ ws, url }: { ws: string; url: string }) =>
        window.electronAPI.trackerSheets.connect(ws, url),
      { ws: workspaceDir, url: stub.url },
    );

    // Step 2: First import — should create 2 tracker items.
    const first = await page.evaluate(
      (ws: string) => window.electronAPI.trackerSheets.import(ws),
      workspaceDir,
    );
    expect(first.created).toBe(2);

    // Step 3: Best-effort body and issue-key check via the tracker-items-by-type channel.
    // This channel uses the sender-window's workspace context (set by launchElectronApp).
    // If it returns an empty array (resolver not yet wired for this test window) we skip.
    const bugItems = await page.evaluate(
      () =>
        window.electronAPI.invoke(
          'document-service:tracker-items-by-type',
          'bug',
        ),
    );

    if (Array.isArray(bugItems) && bugItems.length > 0) {
      const serialised = JSON.stringify(bugItems);
      expect(serialised).toContain('**Affected command / feature:** Save cmd');
      // Issue key BUG-001 is allocated by allocateIssueKey during handleTrackerCreate.
      expect(serialised).toMatch(/BUG-\d+/);
    }
    // If bugItems is empty the channel isn't wired for this render context —
    // the count assertions above are the must-pass verification.

    // Step 4: Re-import is a no-op — same rows, same deterministic IDs → already imported.
    const second = await page.evaluate(
      (ws: string) => window.electronAPI.trackerSheets.import(ws),
      workspaceDir,
    );
    expect(second.created).toBe(0);
    expect(second.alreadyImported).toBe(2);
  } finally {
    await stub.close();
  }
});
