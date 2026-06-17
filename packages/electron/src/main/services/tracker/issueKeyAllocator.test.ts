// packages/electron/src/main/services/tracker/issueKeyAllocator.test.ts
import { describe, it, expect } from 'vitest';
import { prefixForType, formatIssueKey, nextNumberFromKeys } from './issueKeyAllocator';

describe('issue key allocation', () => {
  it('maps known types to prefixes and uppercases unknown ones', () => {
    expect(prefixForType('bug', 'NIM')).toBe('BUG');
    expect(prefixForType('task', 'NIM')).toBe('TASK');
    expect(prefixForType('something', 'NIM')).toBe('SOMETHING');
  });
  it('zero-pads to three digits', () => {
    expect(formatIssueKey('BUG', 1)).toBe('BUG-001');
    expect(formatIssueKey('BUG', 42)).toBe('BUG-042');
    expect(formatIssueKey('BUG', 1234)).toBe('BUG-1234');
  });
  it('computes next number from existing keys of the same prefix', () => {
    expect(nextNumberFromKeys(['BUG-001', 'BUG-003', 'TASK-009'], 'BUG')).toBe(4);
    expect(nextNumberFromKeys([], 'BUG')).toBe(1);
  });
});
