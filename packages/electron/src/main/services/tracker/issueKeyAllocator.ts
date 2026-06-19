// packages/electron/src/main/services/tracker/issueKeyAllocator.ts
import { getWorkspaceState } from '../../utils/store';

export const TYPE_PREFIX: Record<string, string> = {
  bug: 'BUG', task: 'TASK', idea: 'IDEA', decision: 'DEC', plan: 'PLAN', feature: 'FEAT',
};

export function prefixForType(type: string, fallback: string): string {
  return TYPE_PREFIX[type] ?? (type ? type.toUpperCase() : fallback);
}

export function formatIssueKey(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

export function nextNumberFromKeys(keys: string[], prefix: string): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}-(\\d+)$`);
  let max = 0;
  for (const k of keys) {
    const m = k.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

interface DbLike { query<T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }>; }

export async function allocateIssueKey(
  db: DbLike, workspacePath: string, type: string,
): Promise<{ issueNumber: number; issueKey: string }> {
  const fallback = (workspacePath && getWorkspaceState(workspacePath).issueKeyPrefix) || 'NIM';
  const prefix = prefixForType(type, fallback);
  const res = await db.query<{ issue_key: string | null }>(
    `SELECT issue_key FROM tracker_items WHERE workspace = $1 AND issue_key LIKE $2`,
    [workspacePath || '', `${prefix}-%`],
  );
  const next = nextNumberFromKeys(res.rows.map((r) => r.issue_key ?? '').filter(Boolean), prefix);
  return { issueNumber: next, issueKey: formatIssueKey(prefix, next) };
}
