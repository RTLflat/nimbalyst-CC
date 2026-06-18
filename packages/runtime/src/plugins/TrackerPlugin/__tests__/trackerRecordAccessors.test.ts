// packages/runtime/src/plugins/TrackerPlugin/__tests__/trackerRecordAccessors.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadBuiltinTrackers } from '../models/ModelLoader';
import { typeSupportsPlanning } from '../trackerRecordAccessors';

// Load the built-in tracker registry once so getStatusOptions resolves real models.
beforeAll(() => {
  loadBuiltinTrackers();
});

describe('typeSupportsPlanning', () => {
  // Only types with an explicit 'planning' status option return true.
  // Currently only 'feature' has been given planning + ready statuses.
  // bug and task use a simpler to-do/in-progress/in-review/done workflow
  // and do not have a 'planning' status option.

  it('returns true for feature (has planning status)', () => {
    expect(typeSupportsPlanning('feature')).toBe(true);
  });

  it('returns false for bug (no planning status)', () => {
    expect(typeSupportsPlanning('bug')).toBe(false);
  });

  it('returns false for task (no planning status)', () => {
    expect(typeSupportsPlanning('task')).toBe(false);
  });

  it('returns false for decision', () => {
    expect(typeSupportsPlanning('decision')).toBe(false);
  });

  it('returns false for idea', () => {
    expect(typeSupportsPlanning('idea')).toBe(false);
  });

  it('returns false for plan', () => {
    expect(typeSupportsPlanning('plan')).toBe(false);
  });

  it('returns false for an unknown type', () => {
    expect(typeSupportsPlanning('nonexistent-type')).toBe(false);
  });
});
