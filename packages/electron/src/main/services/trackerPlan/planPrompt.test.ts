import { describe, it, expect } from 'vitest';
import { buildPlanningPrompt } from './planPrompt';

describe('buildPlanningPrompt', () => {
  const p = buildPlanningPrompt({
    itemId: 'gsheet-x', type: 'bug', title: 'Save crashes',
    description: 'Crashes on Save', planAbsPath: '/ws/nimbalyst-local/plans/BUG-001-plan.md',
  });
  it('includes title and description as context', () => {
    expect(p).toContain('Save crashes');
    expect(p).toContain('Crashes on Save');
  });
  it('instructs read-only, questions, ExitPlanMode, and the exact plan path', () => {
    expect(p).toMatch(/read-only/i);
    expect(p).toContain('AskUserQuestion');
    expect(p).toContain('ExitPlanMode');
    expect(p).toContain('/ws/nimbalyst-local/plans/BUG-001-plan.md');
    expect(p).toContain('## Summary');
    expect(p).toContain('## Risks');
  });
});
