export function PlanStatusBadge({ status, liveState }: { status?: 'planning' | 'planned'; liveState?: 'processing' | 'waiting' }) {
  const base = 'tracker-plan-badge inline-flex items-center gap-1 text-[11px] text-[var(--nim-text-muted)] px-1.5 py-0.5 rounded bg-[var(--nim-surface-subtle)]';
  if (status === 'planned') return <span className={base}>Planned</span>;
  if (status === 'planning') return <span className={base}>{liveState === 'processing' ? 'Planning…' : 'Waiting for input'}</span>;
  return null;
}
