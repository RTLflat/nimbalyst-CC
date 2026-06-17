import { describe, it, expect } from 'vitest';
import { resolveResearchModel } from '../researchModel';

describe('resolveResearchModel', () => {
  it('downgrades a claude-code default to claude-code:sonnet at low effort', () => {
    expect(resolveResearchModel('claude-code:opus')).toEqual({ model: 'claude-code:sonnet', effort: 'low' });
    expect(resolveResearchModel('claude-code:opus-4-7')).toEqual({ model: 'claude-code:sonnet', effort: 'low' });
  });

  it('uses the claude API Sonnet when the default is already a claude API model', () => {
    // The user demonstrably has a claude API key (their default uses it), so
    // pinning a claude API Sonnet is safe.
    expect(resolveResearchModel('claude:claude-opus-4-6')).toEqual({ model: 'claude:claude-sonnet-4-6', effort: 'low' });
  });

  it('keeps the default model for non-Claude providers (never forces a Claude key)', () => {
    // We must not pin a Claude model onto a user who has not configured that key.
    expect(resolveResearchModel('openai-codex:gpt-5.5')).toEqual({ model: undefined, effort: 'low' });
  });

  it('keeps the default (model undefined) when no usable provider can be derived', () => {
    expect(resolveResearchModel(null)).toEqual({ model: undefined, effort: 'low' });
    expect(resolveResearchModel(undefined)).toEqual({ model: undefined, effort: 'low' });
    expect(resolveResearchModel('claude-sonnet-4-6')).toEqual({ model: undefined, effort: 'low' }); // bare, no provider prefix
  });
});
