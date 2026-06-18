import { getDatabase } from '../../database/initialize';

/**
 * Batched existence check. Returns the subset of `ids` that already exist as
 * tracker rows. Uses `IN (...)` so it works on both PGLite and better-sqlite3.
 */
export async function findExistingTrackerIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = getDatabase();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const res = await db.query<{ id: string }>(
    `SELECT id FROM tracker_items WHERE id IN (${placeholders})`,
    ids,
  );
  return new Set(res.rows.map((r) => r.id));
}
