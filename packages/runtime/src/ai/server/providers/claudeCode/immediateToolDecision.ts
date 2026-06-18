import path from 'path';

export type ToolDecision = { behavior: 'allow' | 'deny'; updatedInput?: any; message?: string };

interface TrustStatus {
  trusted: boolean;
  mode: string | null;
}

interface ResolveImmediateToolDecisionDeps {
  internalMcpTools: readonly string[];
  teamTools: readonly string[];
  trustChecker?: (path: string) => TrustStatus;
  resolveTeamContext: (sessionId: string | undefined) => Promise<string | undefined>;
  handleAskUserQuestion: (
    sessionId: string | undefined,
    input: any,
    options: { signal: AbortSignal; suggestions?: any[]; toolUseID?: string },
    toolUseID?: string
  ) => Promise<ToolDecision>;
  handleExitPlanMode: (
    sessionId: string | undefined,
    input: any,
    options: { signal: AbortSignal; toolUseID?: string },
  ) => Promise<ToolDecision>;
  setCurrentMode: (mode: 'planning' | 'agent' | 'auto') => void;
  getCurrentMode?: () => 'planning' | 'agent' | 'auto' | undefined;
  logSecurity: (message: string, data?: Record<string, unknown>) => void;
}

interface ResolveImmediateToolDecisionParams {
  toolName: string;
  input: any;
  options: { signal: AbortSignal; suggestions?: any[]; toolUseID?: string };
  sessionId: string | undefined;
  pathForTrust: string | undefined;
  /**
   * True when this is a `kind:'tracker-plan'` brainstorming session. Activates
   * the read-only-except-nimbalyst-local write scope below.
   */
  isTrackerPlan?: boolean;
  /** Absolute workspace cwd. Used to resolve relative write targets and to
   * compute the `<workspace>/nimbalyst-local/` containment boundary. */
  workspacePath?: string;
}

const ALLOW_ALL_FILE_EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'Read', 'Glob', 'Grep', 'LS', 'NotebookEdit'];

const TRACKER_PLAN_READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];
const TRACKER_PLAN_WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Robust containment check: is `target` inside (or equal to) `dir`?
 * Normalizes separators and resolves `..`, then requires `target` to be `dir`
 * itself or sit beneath it with a path separator boundary — so a sibling like
 * `nimbalyst-local-evil/` that merely shares the prefix is NOT considered
 * contained.
 */
function isPathInside(dir: string, target: string): boolean {
  const normalizedDir = path.resolve(dir);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget === normalizedDir) return true;
  const withSep = normalizedDir.endsWith(path.sep) ? normalizedDir : normalizedDir + path.sep;
  // path.relative gives '' for equal and a string starting with '..' for escapes.
  const rel = path.relative(normalizedDir, normalizedTarget);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return normalizedTarget.startsWith(withSep);
}

export async function resolveImmediateToolDecision(
  deps: ResolveImmediateToolDecisionDeps,
  params: ResolveImmediateToolDecisionParams
): Promise<ToolDecision | null> {
  const { toolName, input, options, sessionId, pathForTrust, isTrackerPlan, workspacePath } = params;

  if (deps.internalMcpTools.includes(toolName)) {
    return { behavior: 'allow', updatedInput: input };
  }

  // Tracker-plan write-scope profile (the feature's main safety guarantee).
  // A `kind:'tracker-plan'` brainstorming session may read source freely and
  // call planning/skill/question tools, but may write ONLY under
  // `<workspace>/nimbalyst-local/` — it must never edit source files or commit.
  // This branch runs before the generic allow-all-file-edit shortcuts so it
  // actually constrains writes regardless of workspace trust mode.
  if (isTrackerPlan) {
    // Internal MCP tools are already handled above. Allow SDK-native skills,
    // the brainstorming question tool, and any other MCP tool the agent needs.
    if (toolName === 'Skill' || toolName.startsWith('mcp__')) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (toolName === 'AskUserQuestion') {
      return deps.handleAskUserQuestion(sessionId, input, options, options.toolUseID);
    }
    if (TRACKER_PLAN_READ_ONLY_TOOLS.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (TRACKER_PLAN_WRITE_TOOLS.includes(toolName)) {
      const rawTarget: unknown = input?.file_path ?? input?.path ?? input?.notebook_path;
      const denyWrite: ToolDecision = {
        behavior: 'deny',
        message: 'Planning sessions may only write under nimbalyst-local/. Do not edit source files.',
      };
      if (typeof rawTarget !== 'string' || rawTarget.length === 0) {
        return denyWrite;
      }
      const base = workspacePath || '.';
      const absTarget = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(base, rawTarget);
      const allowedRoot = path.join(path.resolve(base), 'nimbalyst-local');
      if (isPathInside(allowedRoot, absTarget)) {
        return { behavior: 'allow', updatedInput: input };
      }
      deps.logSecurity('[canUseTool] Tracker-plan: denying write outside nimbalyst-local/', {
        toolName,
        target: absTarget,
      });
      return denyWrite;
    }
    if (toolName === 'Bash') {
      const command = typeof input?.command === 'string' ? input.command : '';
      // Block git commits; a planning session must not mutate history. Other
      // Bash falls through to normal handling (full sandboxing is out of scope).
      if (/\bgit\s+commit\b/.test(command)) {
        deps.logSecurity('[canUseTool] Tracker-plan: denying git commit', { command });
        return {
          behavior: 'deny',
          message: 'Planning sessions may not commit. Do not run git commit; capture the plan under nimbalyst-local/ instead.',
        };
      }
      return null;
    }
    // Anything else in a tracker-plan session: fall through to existing behavior.
  }

  // In auto mode, MCP server tools and skills are auto-approved. The SDK
  // classifier is the sole decision-maker — if it escalated the call to
  // canUseTool rather than approving silently, it means it wanted user
  // confirmation. But MCP servers are user-configured (trusted by definition)
  // and skills are SDK-native; the CLI auto mode approves these without
  // prompting. Surfacing a Nimbalyst permission widget for `mcp__*` or `Skill`
  // calls would break the contract and frustrate users who chose auto mode.
  if (deps.getCurrentMode?.() === 'auto' && (toolName.startsWith('mcp__') || toolName === 'Skill')) {
    deps.logSecurity('[canUseTool] Auto mode: auto-approving MCP/skill tool:', { toolName });
    return { behavior: 'allow', updatedInput: input };
  }

  if (toolName === 'AskUserQuestion') {
    return deps.handleAskUserQuestion(sessionId, input, options, options.toolUseID);
  }

  if (toolName === 'EnterPlanMode') {
    deps.setCurrentMode('planning');
    return null; // Let SDK handle natively
  }

  if (toolName === 'ExitPlanMode') {
    return deps.handleExitPlanMode(sessionId, input, options);
  }

  if (deps.teamTools.includes(toolName)) {
    if (toolName === 'TeamDelete') {
      const hasExplicitTeam =
        typeof input?.team_name === 'string' && input.team_name.trim().length > 0;
      if (!hasExplicitTeam) {
        const inferredTeam = await deps.resolveTeamContext(sessionId);
        if (inferredTeam) {
          return {
            behavior: 'allow',
            updatedInput: {
              ...input,
              team_name: inferredTeam,
            }
          };
        }
      }
    }
    return { behavior: 'allow', updatedInput: input };
  }

  if (pathForTrust && deps.trustChecker) {
    const trustStatus = deps.trustChecker(pathForTrust);
    if (!trustStatus.trusted) {
      deps.logSecurity('[canUseTool] Workspace not trusted, denying tool:', { toolName });
      return {
        behavior: 'deny',
        message: 'Workspace is not trusted. Please trust the workspace to use AI tools.'
      };
    }

    if (trustStatus.mode === 'bypass-all') {
      // In auto mode the SDK classifier is the decision-maker. When the
      // classifier escalates a tool call to canUseTool (uncertain / risky),
      // we must NOT short-circuit with bypass-all — that would silently
      // approve the exact ops the classifier flagged. Fall through to the
      // normal permission prompt so the user decides.
      if (deps.getCurrentMode?.() !== 'auto') {
        return { behavior: 'allow', updatedInput: input };
      }
      deps.logSecurity('[canUseTool] Auto mode: classifier escalated tool, skipping bypass-all shortcut:', { toolName });
    }

    if (trustStatus.mode === 'allow-all' && ALLOW_ALL_FILE_EDIT_TOOLS.includes(toolName)) {
      deps.logSecurity('[canUseTool] Allow-all mode, auto-approving file tool:', { toolName });
      return { behavior: 'allow', updatedInput: input };
    }
  }

  return null;
}
