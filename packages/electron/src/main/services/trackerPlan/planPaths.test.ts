import { describe, it, expect } from 'vitest';
import { planRelativePath, planAbsolutePath, extractSummary, composeDescription } from './planPaths';

describe('plan paths + composition', () => {
  it('derives the relative plan path from the key', () => {
    expect(planRelativePath('BUG-001')).toBe('nimbalyst-local/plans/BUG-001-plan.md');
  });
  it('joins an absolute path under the workspace', () => {
    expect(planAbsolutePath('/ws', 'TASK-002')).toBe('/ws/nimbalyst-local/plans/TASK-002-plan.md');
  });
  it('extracts the Summary section', () => {
    const md = '## Summary\nFixes the save crash.\nLine two.\n\n## Risks / Open issues\n- none\n';
    expect(extractSummary(md)).toBe('Fixes the save crash.\nLine two.');
  });
  it('returns empty string when no Summary section', () => {
    expect(extractSummary('## Plan\ndo things')).toBe('');
  });
  it('composes description with the plan path appended', () => {
    expect(composeDescription('Fix it.', '/ws/nimbalyst-local/plans/BUG-001-plan.md'))
      .toBe('Fix it.\n\n**Plan:** `/ws/nimbalyst-local/plans/BUG-001-plan.md`');
  });
});
