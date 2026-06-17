/**
 * TrackerResearchService — runs short, read-only background research when a
 * native tracker item is created, and writes the findings into the item's
 * CONTENT body (via the canonical handleTrackerUpdate path, which also keeps
 * data.description in sync, bumps body_version, re-syncs, and seeds the collab
 * Y.Doc). Status is tracked in `data.research` to drive the UI indicator and
 * prevent duplicate runs. All failures are non-fatal.
 */
import { getDatabase } from '../../database/initialize';
import { getAutoTrackerResearchEnabled, getDefaultAIModel } from '../../utils/store';
import { shouldResearchTrackerItem } from './gating';
import { buildResearchPrompt, composeBodyWithResearch } from './researchContent';
import { resolveResearchModel } from './researchModel';
import { MetaAgentService } from '../MetaAgentService';
import { handleTrackerUpdate } from '../../mcp/tools/trackerToolHandlers';
import { GitStatusService } from '../GitStatusService';

function parseData(raw: unknown): Record<string, any> {
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, any>) || {};
}

/** The body `content` column stores JSON.stringify(text); decode back to text. */
function decodeBody(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return typeof v === 'string' ? v : ''; } catch { return raw; }
  }
  return '';
}

export class TrackerResearchService {
  private static instance: TrackerResearchService | null = null;
  static getInstance(): TrackerResearchService {
    return (this.instance ??= new TrackerResearchService());
  }

  private readonly inFlight = new Set<string>();
  private readonly maxConcurrent = 2;
  private active = 0;

  /** Fire-and-forget entry point called from the creation chokepoints. Never throws. */
  onNativeTrackerItemCreated(itemId: string, workspacePath: string): void {
    void this.runForItem(itemId, workspacePath).catch((err) =>
      console.warn('[TrackerResearch] run failed (non-fatal):', err));
  }

  /** Awaited variant (used by tests and the fire-and-forget wrapper). */
  async runForItem(itemId: string, workspacePath: string): Promise<void> {
    if (!workspacePath || this.inFlight.has(itemId) || this.active >= this.maxConcurrent) return;
    const db = getDatabase();
    if (!db) return;

    const { rows } = await db.query(`SELECT id, type, data, source, content FROM tracker_items WHERE id=$1`, [itemId]);
    const row = rows?.[0];
    if (!row) return;
    const data = parseData(row.data);

    const ctx = {
      settingEnabled: getAutoTrackerResearchEnabled(workspacePath),
      isGitRepo: await new GitStatusService().isGitRepo(workspacePath),
      hasDefaultModel: !!getDefaultAIModel(),
    };
    if (!shouldResearchTrackerItem({ source: row.source, data }, ctx)) return;

    this.inFlight.add(itemId);
    this.active++;
    const startedAt = new Date().toISOString();
    try {
      console.log(`[TrackerResearch] starting for ${itemId} (${row.type})`);
      await handleTrackerUpdate({ id: itemId, fields: { research: { status: 'running', startedAt } } }, workspacePath);

      const title = (data.title as string) ?? '';
      const existingBody = decodeBody(row.content);
      const prompt = buildResearchPrompt({ title, type: row.type, body: existingBody });

      // Pin a cheap, fast model (Sonnet at low effort) rather than inheriting the
      // app default, which may be Opus and would silently burn tokens here.
      const { model, effort } = resolveResearchModel(getDefaultAIModel());
      const result = await MetaAgentService.getInstance().runHeadlessReadOnlyTurn(workspacePath, prompt, {
        model,
        effort,
        title: `Research: ${title || itemId}`,
        timeoutMs: 120_000,
      });

      const completedAt = new Date().toISOString();
      // `partial` means the run was halted at the time limit but still gathered
      // usable findings — persist them with a "not exhaustive" note rather than
      // discard the work.
      if ((result.status === 'done' || result.status === 'partial') && result.text) {
        const newBody = composeBodyWithResearch(existingBody, result.text, {
          partial: result.status === 'partial',
        });
        await handleTrackerUpdate(
          { id: itemId, description: newBody, fields: { research: { status: result.status, startedAt, completedAt } } },
          workspacePath,
        );
        console.log(`[TrackerResearch] ${result.status} for ${itemId}: wrote ${result.text.length} chars to body`);
      } else {
        console.warn(`[TrackerResearch] no usable result for ${itemId} (status=${result.status})`);
        await handleTrackerUpdate(
          { id: itemId, fields: { research: { status: 'failed', startedAt, completedAt } } },
          workspacePath,
        );
      }
    } catch (err) {
      console.warn('[TrackerResearch] failed:', err);
      try {
        await handleTrackerUpdate(
          { id: itemId, fields: { research: { status: 'failed', startedAt, error: String(err) } } },
          workspacePath,
        );
      } catch { /* best-effort */ }
    } finally {
      this.inFlight.delete(itemId);
      this.active--;
    }
  }
}
