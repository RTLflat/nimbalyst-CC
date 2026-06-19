/**
 * Characterization tests for TrackerPGLiteStore.applyRemoteItem across BOTH backends.
 *
 * `applyRemoteItem` is the single highest-incident tracker path: it reads the prior
 * label map from `tracker_items.data->'labelsMap'` and unions it with the incoming
 * server delta via `mergeLabelMaps`. That `data->'labelsMap'` sub-extraction returns
 * a *parsed object* on PGLite but a *JSON string* on better-sqlite3 -- the divergence
 * that corrupted labelsMap rows on 2026-06-02 (junk character-keyed entries + a leading
 * null in the projected values). `trackerLabels.test.ts` covers the CRDT helpers and
 * `trackerJsonbDualBackend.test.ts` covers the raw read idiom, but nothing exercised
 * `applyRemoteItem` ITSELF against a real backend until now.
 *
 * These are CHARACTERIZATION tests: they pin the CURRENT behavior of existing code so a
 * future change to the merge path fails here instead of at a user's restart. They do not
 * change production code. The same expected union is asserted for BOTH backends -- a
 * PGLite-only test would not have caught the 2026-06-02 corruption, which only manifested
 * on SQLite.
 *
 * Harness mirrors `trackerJsonbDualBackend.test.ts`: a REAL PGLite instance (hand-rolled
 * full `tracker_items` schema, matching worker.js's base DDL + the ALTERs that add
 * sync_id/type_tags/archived/etc.) and a REAL SQLiteDatabase (full schema from the
 * shipping migrations via runMigrations). `applyRemoteItem` only calls `db.query`, and
 * `SQLiteDatabase.query` runs the Postgres->SQLite dialect translation, so a real
 * SQLiteDatabase faithfully reproduces the production SQLite path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SQLiteDatabase } from '../../../database/sqlite/SQLiteDatabase';
import type { AppDatabase } from '../../../database/PGLiteDatabaseWorker';
import { TrackerPGLiteStore } from '../TrackerPGLiteStore';
import { projectLabelsToValues } from '@nimbalyst/runtime/sync';
import type {
  EncryptedTrackerItemEnvelope,
  TrackerItemPayload,
  LabelsMap,
} from '@nimbalyst/runtime/sync';

// PGLite's first WASM init in a fresh worker can take tens of seconds.
const SETUP_TIMEOUT_MS = 120_000;
const SCHEMA_DIR = path.resolve(__dirname, '..', '..', '..', 'database', 'sqlite', 'schemas');
const WORKSPACE = '/Users/jpitts/proj';

// Full PGLite `tracker_items` schema = worker.js base DDL + the columns later ALTERs add
// (sync_status, content, archived, archived_at, source, source_ref, type_tags, sync_id,
// body_version, deleted_at) that applyRemoteItem's INSERT lists. SQLite gets the same
// columns from 0001_initial.sql via runMigrations.
const PGLITE_TRACKER_ITEMS_DDL = `
  CREATE TABLE tracker_items (
    id TEXT PRIMARY KEY,
    issue_number INTEGER,
    issue_key TEXT,
    type TEXT NOT NULL,
    data JSONB NOT NULL,
    workspace TEXT NOT NULL,
    document_path TEXT,
    line_number INTEGER,
    content JSONB,
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    source TEXT DEFAULT 'inline',
    source_ref TEXT,
    type_tags TEXT[] DEFAULT '{}',
    sync_status TEXT DEFAULT 'local',
    sync_id BIGINT,
    body_version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW(),
    last_indexed TIMESTAMPTZ DEFAULT NOW(),
    title TEXT GENERATED ALWAYS AS (data->>'title') STORED,
    status TEXT GENERATED ALWAYS AS (data->>'status') STORED
  );
  CREATE UNIQUE INDEX idx_tracker_workspace_issue_number
    ON tracker_items(workspace, issue_number) WHERE issue_number IS NOT NULL;
`;

function makeEnvelope(
  itemId: string,
  syncId: number,
  deletedAt: number | null = null,
): EncryptedTrackerItemEnvelope {
  return {
    itemId,
    syncId,
    encryptedPayload: 'x',
    iv: 'iv',
    updatedAt: 0,
    deletedAt,
    orgKeyFingerprint: null,
  };
}

function makePayload(
  itemId: string,
  labels: LabelsMap,
  issueNumber: number,
): TrackerItemPayload {
  return {
    itemId,
    primaryType: 'feature',
    archived: false,
    issueNumber,
    issueKey: `NIM-${issueNumber}`,
    bodyVersion: 0,
    fields: { title: `Item ${itemId}`, status: 'to-do' },
    labels,
    comments: [],
    system: {
      authorIdentity: null,
      lastModifiedBy: null,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
      origin: undefined,
    },
  };
}

const BACKENDS = ['pglite', 'sqlite'] as const;
type BackendName = (typeof BACKENDS)[number];

describe.each(BACKENDS)('applyRemoteItem merge characterization [%s]', (backend: BackendName) => {
  let tmp: string;
  let store: TrackerPGLiteStore;
  let rawQuery: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `nim-apply-remote-${backend}-`));

    if (backend === 'pglite') {
      const pgliteDir = path.join(tmp, 'pglite-db');
      fs.mkdirSync(pgliteDir, { recursive: true });
      const pglite = new PGlite({ dataDir: pgliteDir });
      await (pglite as unknown as { waitReady: Promise<void> }).waitReady;
      await pglite.exec(PGLITE_TRACKER_ITEMS_DDL);
      rawQuery = <T = unknown>(sql: string, params?: unknown[]) =>
        pglite.query<T>(sql, params as unknown[]) as Promise<{ rows: T[] }>;
      teardown = async () => {
        await pglite.close();
      };
    } else {
      const sqlite = new SQLiteDatabase({
        dbDir: path.join(tmp, 'sqlite-db'),
        schemaDir: SCHEMA_DIR,
        slowQueryThresholdMs: 1000,
        sampleRate: 0,
      });
      await sqlite.initialize();
      rawQuery = <T = unknown>(sql: string, params?: unknown[]) =>
        sqlite.query<T>(sql, params ?? []) as Promise<{ rows: T[] }>;
      teardown = async () => {
        await sqlite.close();
      };
    }

    // applyRemoteItem only calls `db.query`; a query-only adapter is sufficient and
    // faithful (the real store holds an AppDatabase whose query method is the same one).
    const db = { query: rawQuery } as unknown as AppDatabase;
    store = new TrackerPGLiteStore(db, WORKSPACE);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await teardown();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Read the persisted labels map back through the project's defensive parse idiom
  // (`data->'labelsMap'` is a JS object on PGLite, a JSON string on SQLite).
  async function readLabelsMap(itemId: string): Promise<LabelsMap | undefined> {
    const { rows } = await rawQuery<{ data: unknown }>(
      `SELECT data FROM tracker_items WHERE id = $1`,
      [itemId],
    );
    if (rows.length === 0) return undefined;
    const raw = rows[0].data;
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { labelsMap?: LabelsMap };
    return data.labelsMap;
  }

  it('create: a new item persists its labels map and projection', async () => {
    await store.applyRemoteItem(
      makeEnvelope('create-1', 1),
      makePayload('create-1', { 'l-bug': { id: 'l-bug', value: 'bug' } }, 101),
    );

    const labelsMap = await readLabelsMap('create-1');
    expect(labelsMap).toEqual({ 'l-bug': { id: 'l-bug', value: 'bug' } });
    expect(projectLabelsToValues(labelsMap)).toEqual(['bug']);
  });

  it('label union merge (the 2026-06-02 path): prior + incoming union on both backends', async () => {
    // First delta: labels {bug}. Second, higher-syncId delta: labels {ui}. The second
    // apply must read the prior data->'labelsMap' back as a real object and UNION it --
    // never spread the JSON string character-by-character (the SQLite corruption).
    await store.applyRemoteItem(
      makeEnvelope('merge-1', 1),
      makePayload('merge-1', { 'l-a': { id: 'l-a', value: 'bug' } }, 102),
    );
    await store.applyRemoteItem(
      makeEnvelope('merge-1', 2),
      makePayload('merge-1', { 'l-b': { id: 'l-b', value: 'ui' } }, 102),
    );

    const labelsMap = await readLabelsMap('merge-1');
    expect(labelsMap).toEqual({
      'l-a': { id: 'l-a', value: 'bug' },
      'l-b': { id: 'l-b', value: 'ui' },
    });

    // Corruption signature guard: no character-indexed (numeric-string) keys, and the
    // projected values are the clean union with no leading null/empty entry.
    const keys = Object.keys(labelsMap ?? {});
    expect(keys.every((k) => !/^\d+$/.test(k))).toBe(true);
    const values = projectLabelsToValues(labelsMap);
    expect([...values].sort()).toEqual(['bug', 'ui']);
    expect(values.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('lower-syncId re-apply unions labels (no clobber of the prior label)', async () => {
    // The store is a pure projection writer with NO syncId stale-guard (unlike the
    // InMemoryTrackerPersistence reference). Label merge is an add-wins union, so a
    // later lower-syncId delta cannot erase a previously-applied label value.
    await store.applyRemoteItem(
      makeEnvelope('stale-1', 5),
      makePayload('stale-1', { 'l-hi': { id: 'l-hi', value: 'high' } }, 103),
    );
    await store.applyRemoteItem(
      makeEnvelope('stale-1', 1),
      makePayload('stale-1', { 'l-st': { id: 'l-st', value: 'stale' } }, 103),
    );

    const values = projectLabelsToValues(await readLabelsMap('stale-1'));
    expect(values).toContain('high'); // the earlier (higher-syncId) label survives
    expect(values).toContain('stale');
  });

  it('tombstone: applyRemoteItem(envelope, null) makes the row read back as deleted', async () => {
    await store.applyRemoteItem(
      makeEnvelope('tomb-1', 1),
      makePayload('tomb-1', { 'l-x': { id: 'l-x', value: 'x' } }, 104),
    );
    expect(await store.getTrackerItem('tomb-1')).not.toBeNull();

    await store.applyRemoteItem(makeEnvelope('tomb-1', 2, 1_700_000_000_000), null);

    // getTrackerItem returns null for a tombstoned (deleted_at != null) row.
    expect(await store.getTrackerItem('tomb-1')).toBeNull();
    const { rows } = await rawQuery<{ deleted_at: unknown }>(
      `SELECT deleted_at FROM tracker_items WHERE id = $1`,
      ['tomb-1'],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
  });
});
