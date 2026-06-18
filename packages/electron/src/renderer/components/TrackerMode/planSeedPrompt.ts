/**
 * Pure, synchronous prompt builder for tracker planning seed.
 * Instructs an agent to investigate, brainstorm, plan, and save.
 */

export interface PlanSeedPromptArgs {
  itemKey: string;
  type: string;
  title: string;
  description: string;
  planAbsPath: string;
}

export function buildPlanSeedPrompt(args: PlanSeedPromptArgs): string {
  const desc = args.description.trim() || '(no description provided)';

  const parts: string[] = [];

  // Header with title and description
  parts.push(`Plan: ${args.title}`);
  parts.push(`\n${desc}`);

  // Read-only investigation instruction
  parts.push(
    `\nBefore proceeding, investigate the existing code and context relevant to this ${args.type}. ` +
      `Your analysis is read-only — examine the codebase to understand the problem, ask informed questions only, ` +
      `and do not modify anything yet.`
  );

  // For bugs, add root-cause instruction
  if (args.type === 'bug') {
    parts.push(
      `\nOnce you have investigated, post a concise summary of your read of the root cause before asking questions. ` +
        `Summarize: what I found, my understanding of the problem, and the likely root cause.`
    );
  }

  // Brainstorming and planning instruction
  parts.push(
    `\nRun the \`nimbalyst-planning:brainstorming\` skill to explore the problem space. ` +
      `Follow it through to \`nimbalyst-planning:writing-plans\` to produce a detailed implementation plan.`
  );

  // Plan output instruction
  parts.push(
    `\nWrite the plan to: ${args.planAbsPath}`
  );

  // Final instruction to save and stop (don't mention not committing or implementing - just move forward)
  parts.push(
    `\nWhen the plan is written and ready, call the \`tracker_plan_save\` tool with the plan path and a 2–4 sentence summary of the plan. ` +
      `Then stop.`
  );

  return parts.join('\n');
}
