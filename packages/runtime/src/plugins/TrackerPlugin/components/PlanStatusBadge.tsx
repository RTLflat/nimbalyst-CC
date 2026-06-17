/**
 * Small inline indicator for a tracker item's "Plan this item" state.
 * Shows a static "Planned" chip when a plan has been saved; renders nothing otherwise.
 */
export function PlanStatusBadge({ status }: { status?: 'planned' }) {
  if (status === 'planned') {
    return (
      <span className="tracker-plan-badge inline-flex items-center gap-1 text-[11px] text-[var(--nim-text-muted)] px-1.5 py-0.5 rounded bg-[var(--nim-surface-subtle)]">
        Planned
      </span>
    );
  }
  return null;
}
