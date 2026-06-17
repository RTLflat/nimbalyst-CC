/**
 * Pure gating logic for auto preliminary research on tracker items.
 *
 * Kept side-effect-free so it is trivially unit-testable. The orchestrator
 * (TrackerResearchService) supplies the runtime context (setting/git/model)
 * and the item's `source` + `data`.
 */
export interface ResearchGateContext {
  /** The per-workspace `autoTrackerResearch` setting is enabled. */
  settingEnabled: boolean;
  /** The workspace is a git repository. */
  isGitRepo: boolean;
  /** A default agent model is configured. */
  hasDefaultModel: boolean;
}

export interface ResearchGateItem {
  /** Legacy source column: 'native' | 'import' | 'inline' | 'frontmatter'. */
  source?: string;
  /** Parsed `data` JSONB of the tracker item. */
  data: Record<string, any>;
}

/**
 * Decide whether to run auto-research for a freshly created tracker item.
 *
 * Runs only for user-created native items, in a git repo, with the feature on
 * and a default model available. Skips imports, agent-created items, and items
 * already researched or mid-research.
 */
export function shouldResearchTrackerItem(item: ResearchGateItem, ctx: ResearchGateContext): boolean {
  if (!ctx.settingEnabled || !ctx.isGitRepo || !ctx.hasDefaultModel) return false;
  const data = item.data || {};
  if (item.source === 'import') return false;
  if (data.origin?.kind === 'external') return false;
  if (data.createdByAgent === true) return false;
  const status = data.research?.status;
  if (status === 'running' || status === 'done') return false;
  return true;
}
