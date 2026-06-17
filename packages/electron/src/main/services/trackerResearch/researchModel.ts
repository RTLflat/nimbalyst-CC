import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import type { EffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';

/**
 * Pick the model + effort for background tracker research.
 *
 * Research is read-only file identification — Sonnet at low effort is the right
 * tradeoff: capable enough to find the relevant code, cheap/fast enough to run
 * automatically on every item. We deliberately do NOT inherit the user's default
 * model (it may be Opus, which silently burns tokens on a background feature).
 *
 * We only switch to a Claude model on a provider the user already has configured,
 * so we never force a Claude API key onto a user who hasn't set one up:
 *  - claude-code default  -> `claude-code:sonnet`        (subscription; no API billing)
 *  - claude (API) default -> `claude:claude-sonnet-4-6`  (key demonstrably configured)
 *  - anything else        -> `undefined` (keep their default model)
 *
 * Effort is always `low`.
 */
export function resolveResearchModel(defaultModel: string | null | undefined): {
  model: string | undefined;
  effort: EffortLevel;
} {
  const provider = defaultModel ? ModelIdentifier.tryParse(defaultModel)?.provider ?? null : null;
  if (provider === 'claude-code') return { model: 'claude-code:sonnet', effort: 'low' };
  if (provider === 'claude') return { model: 'claude:claude-sonnet-4-6', effort: 'low' };
  return { model: undefined, effort: 'low' };
}
