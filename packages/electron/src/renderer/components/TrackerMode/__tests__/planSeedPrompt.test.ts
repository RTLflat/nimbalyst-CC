import { describe, it, expect } from 'vitest';
import { buildPlanSeedPrompt } from '../planSeedPrompt';

describe('buildPlanSeedPrompt', () => {
  it('contains title and description', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'BUG-001',
      type: 'bug',
      title: 'Save crash on startup',
      description: 'App crashes when opening file dialog without workspace',
      planAbsPath: '/home/user/nimbalyst-local/plans/BUG-001.md',
    });
    expect(p).toContain('Save crash on startup');
    expect(p).toContain('App crashes when opening file dialog without workspace');
  });

  it('falls back to (no description provided) when description is empty', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Implement feature',
      description: '',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).toContain('Implement feature');
    expect(p).toMatch(/no description provided/i);
  });

  it('contains read-only or investigate instruction', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'BUG-001',
      type: 'bug',
      title: 'Debug issue',
      description: 'Something is broken',
      planAbsPath: '/home/user/nimbalyst-local/plans/BUG-001.md',
    });
    expect(p).toMatch(/read-only|investigate/i);
  });

  it('contains nimbalyst-planning:brainstorming skill', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Plan work',
      description: 'Needs planning',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).toContain('nimbalyst-planning:brainstorming');
  });

  it('contains writing-plans skill', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Plan work',
      description: 'Needs planning',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).toContain('writing-plans');
  });

  it('contains exact planAbsPath', () => {
    const planPath = '/home/user/nimbalyst-local/plans/FEATURE-123.md';
    const p = buildPlanSeedPrompt({
      itemKey: 'FEATURE-123',
      type: 'feature',
      title: 'Add feature',
      description: 'Feature description',
      planAbsPath: planPath,
    });
    expect(p).toContain(planPath);
  });

  it('contains tracker_plan_save tool', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'BUG-001',
      type: 'bug',
      title: 'Fix bug',
      description: 'Bug details',
      planAbsPath: '/home/user/nimbalyst-local/plans/BUG-001.md',
    });
    expect(p).toContain('tracker_plan_save');
  });

  it('for type=bug includes root cause instruction', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'BUG-001',
      type: 'bug',
      title: 'Fix bug',
      description: 'Bug details',
      planAbsPath: '/home/user/nimbalyst-local/plans/BUG-001.md',
    });
    expect(p).toMatch(/root.?cause/i);
  });

  it('for type=task does NOT include root cause instruction', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Do task',
      description: 'Task details',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).not.toMatch(/root.?cause/i);
  });

  it('does not mention visual companion or browser', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Plan work',
      description: 'Needs planning',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).not.toMatch(/visual.*companion|browser.*visual/i);
  });

  it('does not mention committing or implementing', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Plan work',
      description: 'Needs planning',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).not.toMatch(/do not.*commit|do not.*implement/i);
  });

  it('instructs to call tracker_plan_save with summary', () => {
    const p = buildPlanSeedPrompt({
      itemKey: 'TASK-001',
      type: 'task',
      title: 'Plan work',
      description: 'Needs planning',
      planAbsPath: '/home/user/nimbalyst-local/plans/TASK-001.md',
    });
    expect(p).toMatch(/tracker_plan_save.*summary/i);
  });
});
