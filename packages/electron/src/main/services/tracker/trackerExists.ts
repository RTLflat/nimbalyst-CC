import { getDatabase } from '../../database/initialize';

export async function trackerExists(id: string): Promise<boolean> {
  const db = getDatabase();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM tracker_items WHERE id = $1 LIMIT 1`,
    [id],
  );
  return res.rows.length > 0;
}
