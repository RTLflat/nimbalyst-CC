/**
 * Pure, synchronous prompt builder for tracker item dispatch.
 * Callers resolve all async values (body content, plan) before calling this.
 */

import { fenceExternalContent } from './promptFencing';

export interface DispatchPromptItem {
  id: string;
  title: string;
  primaryType: string;
  status?: string;
  priority?: string;
  /** Resolved body content (bodyText.trim() || description from data field). */
  description?: string;
  /** Present when item has a saved plan from the planning flow. */
  plan?: { path: string; summary?: string };
  /** documentPath for file-backed items — produces a `Source: @<path>` line. */
  sourcePath?: string;
  /**
   * When true, the description came from an externally-imported item and is
   * wrapped in a "treat as DATA" fence (defense-in-depth, not a guarantee).
   * The one-line title is left as-is. When unset/false, output is
   * byte-identical to before this flag existed.
   */
  untrustedContent?: boolean;
}

export function buildDispatchPrompt(item: DispatchPromptItem): string {
  const head = `implement tracker item ${item.id}: ${item.title}`;
  const tail = `Update this tracker item's status when done using tracker_update with id "${item.id}".`;

  if (item.plan?.path) {
    // Plan branch: direct agent to follow the saved plan file.
    const parts: string[] = [head];
    parts.push(`type: ${item.primaryType}`);
    if (item.plan.summary) parts.push(item.plan.summary);
    parts.push(`Follow the implementation plan at: ${item.plan.path}`);
    parts.push(tail);
    return parts.filter(Boolean).join('\n\n');
  }

  // Non-plan branch: reproduce the full rich prompt from the original inline builder.
  const lines: string[] = [];
  lines.push(head);

  // Meta line: type, status, priority (whichever are present)
  const meta: string[] = [];
  if (item.primaryType) meta.push(`type: ${item.primaryType}`);
  if (item.status) meta.push(`status: ${item.status}`);
  if (item.priority) meta.push(`priority: ${item.priority}`);
  if (meta.length > 0) lines.push(meta.join(', '));

  // Body detail
  if (item.description) {
    lines.push(
      item.untrustedContent
        ? fenceExternalContent('description', item.description)
        : `\n${item.description}`
    );
  }

  // File-backed source line
  if (item.sourcePath) lines.push(`\nSource: @${item.sourcePath}`);

  lines.push(`\n${tail}`);
  return lines.join('\n');
}
