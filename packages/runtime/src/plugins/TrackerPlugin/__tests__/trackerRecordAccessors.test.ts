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
  // feature, bug, and task all have planning + ready statuses in the hardcoded
  // builtinTrackers in ModelLoader.ts (the active runtime source).

  it('returns true for feature (has planning status)', () => {
    expect(typeSupportsPlanning('feature')).toBe(true);
  });

  it('returns true for bug (has planning status)', () => {
    expect(typeSupportsPlanning('bug')).toBe(true);
  });

  it('returns true for task (has planning status)', () => {
    expect(typeSupportsPlanning('task')).toBe(true);
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
