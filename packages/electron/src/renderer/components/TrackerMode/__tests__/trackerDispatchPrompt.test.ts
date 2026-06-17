import { describe, it, expect } from 'vitest';
import { buildDispatchPrompt } from '../trackerDispatchPrompt';

describe('buildDispatchPrompt', () => {
  it('references the plan path when present', () => {
    const p = buildDispatchPrompt({
      id: 'id1',
      title: 'Save crash',
      primaryType: 'bug',
      description: 'old',
      plan: { path: '/ws/nimbalyst-local/plans/BUG-001-plan.md', summary: 'Fix it.' },
    });
    expect(p).toContain('implement tracker item id1: Save crash');
    expect(p).toContain('/ws/nimbalyst-local/plans/BUG-001-plan.md');
    expect(p).toContain('tracker_update');
  });

  it('falls back to description when no plan', () => {
    const p = buildDispatchPrompt({ id: 'id1', title: 'Save crash', primaryType: 'bug', description: 'steps here' });
    expect(p).toContain('steps here');
    expect(p).not.toContain('nimbalyst-local/plans');
  });

  it('non-plan case includes type meta line', () => {
    const p = buildDispatchPrompt({
      id: 'TASK-42',
      title: 'Do thing',
      primaryType: 'feature',
      status: 'in-progress',
      priority: 'high',
      description: 'some detail',
    });
    expect(p).toContain('type: feature');
    expect(p).toContain('status: in-progress');
    expect(p).toContain('priority: high');
    expect(p).toContain('some detail');
    expect(p).toContain('tracker_update');
  });

  it('non-plan case includes Source line when sourcePath provided', () => {
    const p = buildDispatchPrompt({
      id: 'FILE-1',
      title: 'File backed',
      primaryType: 'bug',
      description: 'body content',
      sourcePath: '/workspace/docs/FILE-1.md',
    });
    expect(p).toContain('Source: @/workspace/docs/FILE-1.md');
    expect(p).toContain('body content');
    expect(p).toContain('tracker_update');
  });

  it('plan case includes type but not sourcePath', () => {
    const p = buildDispatchPrompt({
      id: 'BUG-5',
      title: 'Crash on load',
      primaryType: 'bug',
      plan: { path: '/plans/BUG-5.md' },
      sourcePath: '/docs/BUG-5.md',
    });
    expect(p).toContain('type: bug');
    expect(p).toContain('/plans/BUG-5.md');
    expect(p).toContain('tracker_update');
    // sourcePath is not appended in plan branch
    expect(p).not.toContain('Source: @');
  });
});
