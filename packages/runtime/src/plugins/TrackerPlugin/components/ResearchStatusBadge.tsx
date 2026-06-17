import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import type { ResearchStatus } from '../trackerRecordAccessors';

/**
 * Small inline indicator for a tracker item's auto-research state.
 * Shows a spinner + "Researching…" while running, a subtle hint when failed,
 * and nothing once done (or when no research has run).
 */
export function ResearchStatusBadge({ status }: { status?: ResearchStatus }) {
  if (status === 'running') {
    return (
      <span className="tracker-research-badge inline-flex items-center gap-1 text-[11px] text-[var(--nim-text-muted)]">
        <MaterialSymbol icon="progress_activity" size={13} className="animate-spin" />
        Researching…
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="tracker-research-badge text-[11px] text-[var(--nim-text-faint)]"
        title="Auto-research failed"
      >
        research failed
      </span>
    );
  }
  return null;
}
