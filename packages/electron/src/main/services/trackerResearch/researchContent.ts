/**
 * Pure helpers for the auto-research feature: build the read-only research
 * prompt and compose the result into the item body inside a regenerable
 * marker block (so re-runs replace, and user-authored text is never clobbered).
 */

/** Markdown heading that delimits the auto-research section (renders cleanly in
 * the markdown body editor; no HTML-comment markers, which would show literally). */
export const RESEARCH_HEADING = '## Preliminary research (auto-generated)';

/** Trailing note appended to the research block when the run was halted at its
 * time limit, so the body honestly signals the findings are incomplete. Lives
 * inside the regenerable block so a later full run replaces it. */
export const PARTIAL_RESEARCH_NOTE =
  '_Note: research stopped at the time limit — this is a partial list and is not exhaustive._';

export function buildResearchPrompt(input: { title: string; type: string; body: string }): string {
  return [
    `You are doing brief, READ-ONLY preliminary research for a ${input.type} tracker item.`,
    `Title: ${input.title}`,
    input.body ? `Existing notes:\n${input.body}` : '',
    '',
    'Using ONLY read-only tools (search_files, read_file, list_files), identify the few',
    'most relevant files/classes for this item. Do not modify anything.',
    'Reply with concise markdown: a short "Relevant files" list (path - one-line why),',
    'then 2-4 sentences on how they fit together and any gotchas. Keep it under ~200 words.',
  ].filter(Boolean).join('\n');
}

/**
 * Append the auto-research section to a body as clean markdown. If a prior
 * auto-research section exists (identified by RESEARCH_HEADING), replace it
 * (it is assumed to run to the end of the body, since research appends last).
 * User-authored text before the heading is preserved verbatim.
 */
export function composeBodyWithResearch(
  existingBody: string,
  researchText: string,
  opts: { partial?: boolean } = {},
): string {
  const note = opts.partial ? `\n\n${PARTIAL_RESEARCH_NOTE}` : '';
  const block = `${RESEARCH_HEADING}\n\n${researchText.trim()}${note}`;
  const body = (existingBody ?? '').trimEnd();
  const idx = body.indexOf(RESEARCH_HEADING);
  if (idx !== -1) {
    const before = body.slice(0, idx).trimEnd();
    return before ? `${before}\n\n${block}` : block;
  }
  return body ? `${body}\n\n${block}` : block;
}
