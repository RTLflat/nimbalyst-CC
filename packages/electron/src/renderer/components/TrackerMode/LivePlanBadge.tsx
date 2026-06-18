import React from 'react';
import { useAtomValue } from 'jotai';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordField, getPlanStatus } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { PlanStatusBadge } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/PlanStatusBadge';
import { sessionProcessingAtom } from '../../store/atoms/sessions';

interface LivePlanBadgeProps {
  item: TrackerRecord;
}

/**
 * Electron-only wrapper around PlanStatusBadge that reads live session processing
 * state from the Jotai atom family to drive the "Planning..." vs "Waiting for input"
 * distinction. The hook is always called (unconditionally) with either the real
 * session ID or a sentinel empty string, avoiding React hooks-in-conditionals errors.
 */
export function LivePlanBadge({ item }: LivePlanBadgeProps) {
  const planStatus = getPlanStatus(item);
  const plan = getRecordField(item, 'plan') as { status?: string; sessionId?: string } | undefined;
  const sessionId = plan?.sessionId ?? '';

  // Always call the hook — atomFamily with '' returns a stable false atom when no session
  const processing = useAtomValue(sessionProcessingAtom(sessionId));

  const liveState = planStatus === 'planning'
    ? (processing ? 'processing' : 'waiting')
    : undefined;

  return <PlanStatusBadge status={planStatus} liveState={liveState} />;
}
