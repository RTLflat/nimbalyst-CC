// packages/electron/src/main/services/trackerPlan/handleTrackerPlanExitApproval.ts
import { isTrackerPlanSession } from './isTrackerPlanSession';

export interface TrackerPlanExitApprovalDeps {
  /** The SDK tool_use ID / ExitPlanMode requestId being responded to. */
  requestId: string;
  sessionId: string;
  /** Workspace path (SessionMeta.workspaceId). */
  workspacePath: string;
  /** Raw `ai_sessions.metadata` value (parsed object or JSON string). */
  metadata: unknown;
  /** The renderer's approve/deny response for this ExitPlanMode prompt. */
  response: { approved: boolean; clearContext?: boolean; feedback?: string };
  /**
   * Reads the durable `exit_plan_mode_request` message for this session/request
   * to recover the planFilePath + planSummary that the SDK tool input carried.
   */
  readPlanRequest: (
    sessionId: string,
    requestId: string,
  ) => Promise<{ planFilePath: string; planSummary?: string }>;
  /** Save the plan + rewrite the tracker description (Task 4). */
  onPlanApproved: (args: {
    itemId: string;
    issueKey: string;
    workspacePath: string;
    sessionId: string;
    planFilePath: string;
    planSummary?: string;
  }) => Promise<{ planPath: string }>;
  /**
   * Resolves the awaited ExitPlanMode confirmation in AgentToolHooks. We pass
   * `{ approved: false }` here so AgentToolHooks returns a `deny` decision and
   * the agent stays in planning instead of implementing.
   */
  resolveConfirmation: (
    requestId: string,
    response: { approved: boolean; clearContext?: boolean; feedback?: string },
  ) => void;
}

export interface TrackerPlanExitApprovalResult {
  /** True when the tracker-plan branch fully handled the approval. */
  handled: boolean;
  /**
   * True when the caller should NOT set the session mode to 'agent' (the
   * tracker-plan session stays in planning). Only meaningful when handled.
   */
  shouldSetAgentMode: boolean;
  /** True when this was a tracker-plan approval but the plan file was missing. */
  missingPlan?: boolean;
}

const NOT_HANDLED: TrackerPlanExitApprovalResult = { handled: false, shouldSetAgentMode: true };

/**
 * Tracker-plan branch of the ExitPlanMode approval handler. For a tracker-plan
 * session that the user APPROVED, this captures the plan (save file + rewrite
 * the tracker description) and then resolves the ExitPlanMode confirmation as a
 * DENY so the agent does NOT proceed to implement — implementation is a
 * separate later dispatch.
 *
 * Returns `handled: false` for any session/response this branch should not own
 * (non-tracker-plan, a denial, or a missing durable plan request) so the caller
 * runs the existing default behavior unchanged.
 */
export async function handleTrackerPlanExitApproval(
  deps: TrackerPlanExitApprovalDeps,
): Promise<TrackerPlanExitApprovalResult> {
  const binding = isTrackerPlanSession(deps.metadata);
  if (!binding) {
    return NOT_HANDLED;
  }

  // A denial of a tracker-plan session needs no special capture — let the
  // normal deny path ("continue planning") run.
  if (!deps.response.approved) {
    return NOT_HANDLED;
  }

  const { planFilePath, planSummary } = await deps.readPlanRequest(deps.sessionId, deps.requestId);

  // Missing durable plan request: do NOT silently swallow. Report not-handled
  // with a missingPlan flag so the caller logs and falls through to the normal
  // behavior (the prompt must not hang).
  if (!planFilePath) {
    return { handled: false, shouldSetAgentMode: true, missingPlan: true };
  }

  // Capture the plan BEFORE resolving the confirmation.
  await deps.onPlanApproved({
    itemId: binding.trackerItemId,
    issueKey: binding.issueKey,
    workspacePath: deps.workspacePath,
    sessionId: deps.sessionId,
    planFilePath,
    planSummary,
  });

  // Resolve as DENY so AgentToolHooks returns `permissionDecision: 'deny'` and
  // the agent stays in planning instead of implementing.
  deps.resolveConfirmation(deps.requestId, {
    approved: false,
    feedback: 'Plan accepted and saved.',
  });

  return { handled: true, shouldSetAgentMode: false };
}
