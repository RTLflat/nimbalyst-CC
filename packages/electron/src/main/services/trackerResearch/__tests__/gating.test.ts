import { describe, it, expect } from 'vitest';
import { shouldResearchTrackerItem } from '../gating';

const base = { settingEnabled: true, isGitRepo: true, hasDefaultModel: true };
const item = (data: any, source = 'native') => ({ source, data });

describe('shouldResearchTrackerItem', () => {
  it('allows a fresh user-created native item', () => {
    expect(shouldResearchTrackerItem(item({ createdByAgent: false }), base)).toBe(true);
  });

  it('allows when createdByAgent is absent', () => {
    expect(shouldResearchTrackerItem(item({}), base)).toBe(true);
  });

  it('skips imports (external origin or import source)', () => {
    expect(shouldResearchTrackerItem(item({ origin: { kind: 'external' } }, 'native'), base)).toBe(false);
    expect(shouldResearchTrackerItem(item({}, 'import'), base)).toBe(false);
  });

  it('allows Google Sheet imports (minimal rows benefit from research)', () => {
    const sheet = item({ origin: { kind: 'external', external: { providerId: 'google-sheets' } } }, 'import');
    expect(shouldResearchTrackerItem(sheet, base)).toBe(true);
  });

  it('still skips other external imports (e.g. github)', () => {
    const gh = item({ origin: { kind: 'external', external: { providerId: 'github-issues' } } }, 'import');
    expect(shouldResearchTrackerItem(gh, base)).toBe(false);
  });

  it('skips agent-created items', () => {
    expect(shouldResearchTrackerItem(item({ createdByAgent: true }), base)).toBe(false);
  });

  it('skips when already researched or running', () => {
    expect(shouldResearchTrackerItem(item({ research: { status: 'running' } }), base)).toBe(false);
    expect(shouldResearchTrackerItem(item({ research: { status: 'done' } }), base)).toBe(false);
  });

  it('re-allows when a prior run failed', () => {
    expect(shouldResearchTrackerItem(item({ research: { status: 'failed' } }), base)).toBe(true);
  });

  it('skips when any gate is off', () => {
    expect(shouldResearchTrackerItem(item({}), { ...base, settingEnabled: false })).toBe(false);
    expect(shouldResearchTrackerItem(item({}), { ...base, isGitRepo: false })).toBe(false);
    expect(shouldResearchTrackerItem(item({}), { ...base, hasDefaultModel: false })).toBe(false);
  });
});
