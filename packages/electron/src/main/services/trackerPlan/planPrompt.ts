export function buildPlanningPrompt(args: {
  itemId: string;
  type: string;
  title: string;
  description: string;
  planAbsPath: string;
}): string {
  const desc = args.description?.trim() ? args.description.trim() : '(no description provided)';
  return [
    `You are producing a READ-ONLY implementation plan for this ${args.type} tracker item.`,
    `Do NOT edit any source files. Analyze the codebase with read-only tools only.`,
    ``,
    `Title: ${args.title}`,
    `Description:`,
    desc,
    ``,
    `Ask clarifying questions with the AskUserQuestion tool whenever the title or`,
    `description leave a real ambiguity that would change the implementation.`,
    ``,
    `When ready, write the full implementation plan to this exact file path and then`,
    `call ExitPlanMode with that planFilePath:`,
    `  ${args.planAbsPath}`,
    ``,
    `The plan MUST begin with:`,
    `  "## Summary" — 2-4 sentences restating the bug/task in your own words.`,
    `  "## Risks / Open issues" — anything that could block or complicate implementation.`,
    `Then the step-by-step plan (files to touch, approach, tests).`,
    `This is planning only; do not implement the fix.`,
  ].join('\n');
}
