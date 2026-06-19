/**
 * Tracker JSONB sub-extraction parity across BOTH backends.
 *
 * The single most expensive recurring tracker bug class is the
 * PGLite-vs-better-sqlite3 JSONB divergence documented in
 * `packages/electron/DATABASE.md`:
 *
 *   - `data->'key'` returns a *parsed object* on PGLite but a *JSON string*
 *     on better-sqlite3. Trusting the sub-extraction was already an object
 *     corrupted tracker `labelsMap` rows on 2026-06-02.
 *
 * No test ran tracker code against both backends, so the next such divergence
 * would ship unnoticed. This parameterized suite seeds an identical tracker
 * row in a REAL PGLite instance and a REAL SQLite instance (no mocks — a mock
 * cannot reproduce the parsed-object-vs-JSON-string split) and asserts the
 * tracker read paths resolve identically:
 *
 *   1. The importer-registry URN lookup
 *      (`data->'origin'->'external'->>'urn'`, see
 *      `TrackerImporterRegistry.findLocalIdByUrn` + migration 0010) returns
 *      the seeded id on both backends.
 *   2. Selecting the whole `data` column and applying the project's defensive
 *      parse idiom (`typeof x === 'string' ? JSON.parse(x) : x`) yields a
 *      deep-equal nested `labelsMap` object on both backends — the exact shape
 *      that regressed on 2026-06-02.
 *
 * Harness pattern mirrors the dual-backend exemplars under
 * `database/sqlite/__tests__/` (PGLiteToSQLiteMigrator.test.ts,
 * MigrationOrchestrator.fixtureRoundtrip.test.ts): a throwaway PGLite data dir
 * with a hand-rolled JSONB `tracker_items` table, and a throwaway
 * `SQLiteDatabase` whose `tracker_items` (TEXT `data` column) comes from the
 * shipping migrations (0001_initial.sql + 0010_tracker_origin_urn.sql, applied
 * by `runMigrations` during `initialize()`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SQLiteDatabase } from '../../../database/sqlite/SQLiteDatabase';

// PGLite's first WASM init in a fresh worker can take tens of seconds; give the
// one-time per-backend setup room beyond the 10s default hook timeout.
const SETUP_TIMEOUT_MS = 120_000;

// Shipping migration SQL (0001_initial.sql + 0010_tracker_origin_urn.sql etc.).
const SCHEMA_DIR = path.resolve(__dirname, '..', '..', '..', 'database', 'sqlite', 'schemas');

const WORKSPACE = '/Users/jpitts/proj';
const SEED_ID = 'tr-import-1';
const SEED_URN = 'google-sheets://sheet-abc/row-1';

// Nested object under `data`. This is the shape the 2026-06-02 regression
// corrupted: when `data->'labelsMap'` (or the whole `data`) came back as a JSON
// string on SQLite and the read path assumed it was already an object.
const LABELS_MAP = {
  'lbl-bug': { name: 'bug', color: '#d73a49', order: 0 },
  'lbl-ui': { name: 'ui', color: '#0e8a16', order: 1 },
  'lbl-nested': { name: 'nested', meta: { synced: true, tags: ['a', 'b'] } },
};

const SEED_DATA = {
  title: 'Imported sheet row',
  status: 'open',
  origin: {
    external: { urn: SEED_URN, provider: 'google-sheets' },
  },
  labelsMap: LABELS_MAP,
};

type RunQuery = <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;

const BACKENDS = ['pglite', 'sqlite'] as const;
type BackendName = (typeof BACKENDS)[number];

describe.each(BACKENDS)('tracker JSONB sub-extraction parity [%s]', (backend: BackendName) => {
  let tmp: string;
  let db: { query: RunQuery };
  let teardown: () => Promise<void>;

  // One real backend instance per backend, seeded once. Every assertion below
  // is read-only, so sharing the seeded row keeps the (slow) PGLite WASM init
  // to a single cold start.
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `nim-tracker-jsonb-${backend}-`));

    if (backend === 'pglite') {
      const pgliteDir = path.join(tmp, 'pglite-db');
      fs.mkdirSync(pgliteDir, { recursive: true });
      const pglite = new PGlite({ dataDir: pgliteDir });
      await (pglite as unknown as { waitReady: Promise<void> }).waitReady;
      // Minimal JSONB tracker_items + the same expression index migration 0010
      // adds (worker.js creates the matching PGLite index in production). The
      // exemplar harness hand-rolls the PGLite schema rather than running the
      // SQLite-flavored migration files.
      await pglite.exec(`
        CREATE TABLE tracker_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data JSONB NOT NULL,
          workspace TEXT NOT NULL
        );
        CREATE INDEX idx_tracker_origin_urn
          ON tracker_items ((data->'origin'->'external'->>'urn'));
      `);
      db = {
        query: (<T = unknown>(sql: string, params?: unknown[]) =>
          pglite.query<T>(sql, params as unknown[]) as Promise<{ rows: T[] }>) as RunQuery,
      };
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
      db = {
        query: (<T = unknown>(sql: string, params?: unknown[]) =>
          sqlite.query<T>(sql, params ?? [])) as RunQuery,
      };
      teardown = async () => {
        await sqlite.close();
      };
    }

    // Seed one identical tracker row in whichever backend is active. `$3::jsonb`
    // casts on PGLite; the SQLite dialect translator strips the cast and stores
    // the JSON as TEXT.
    await db.query(
      `INSERT INTO tracker_items(id, type, data, workspace)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [SEED_ID, 'task', JSON.stringify(SEED_DATA), WORKSPACE],
    );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await teardown();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('inserts the seeded tracker row', async () => {
    const { rows } = await db.query<{ c: number }>(
      `SELECT COUNT(*) AS c FROM tracker_items WHERE workspace = $1`,
      [WORKSPACE],
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it("resolves data->'origin'->'external'->>'urn' equality to the seeded id", async () => {
    // The findLocalIdByUrn query path (TrackerImporterRegistry.ts). The `->`/
    // `->>` chain must resolve identically on PGLite (JSONB operators) and on
    // SQLite (>= 3.38 JSON operators; left untranslated by dialectTranslator).
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM tracker_items
        WHERE workspace = $1
          AND data->'origin'->'external'->>'urn' = $2
        LIMIT 1`,
      [WORKSPACE, SEED_URN],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(SEED_ID);
  });

  it("returns null-equivalent for an unknown URN (no false positive match)", async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM tracker_items
        WHERE workspace = $1
          AND data->'origin'->'external'->>'urn' = $2
        LIMIT 1`,
      [WORKSPACE, 'google-sheets://sheet-abc/row-999'],
    );
    expect(rows).toHaveLength(0);
  });

  it('round-trips a nested labelsMap object identically under the defensive parse idiom', async () => {
    // SELECT the whole `data` column. The 2026-06-02 divergence: PGLite returns
    // a parsed JS object for the JSONB column; better-sqlite3 returns the JSON
    // as a string. The project's defensive idiom normalizes both shapes.
    const { rows } = await db.query<{ data: unknown }>(
      `SELECT data FROM tracker_items WHERE id = $1`,
      [SEED_ID],
    );
    expect(rows).toHaveLength(1);

    const raw = rows[0].data;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      labelsMap: Record<string, unknown>;
    };

    // The exact assertion that guards the 2026-06-02 regression: the nested
    // labelsMap must come back as a deep-equal object on BOTH backends.
    expect(parsed.labelsMap).toEqual(LABELS_MAP);
  });
});
