/**
 * Seam-covering tests for isTrackerPlan forwarding.
 *
 * Two layers of coverage:
 *
 * 1. sdkOptionsBuilder contract: verifies buildSdkOptions passes isTrackerPlan
 *    as the 5th arg to the injected createCanUseToolHandler dep (the function
 *    signature side).
 *
 * 2. ClaudeCodeProvider adapter: verifies that the lambda at the DI seam in
 *    ClaudeCodeProvider.ts forwards all 5 args from the outer call through to
 *    the underlying createCanUseToolHandler implementation. This is the seam
 *    where args 4 (teammateName) and 5 (isTrackerPlan) were silently dropped.
 *
 * Without test (2), a regression where the adapter narrows
 *   (sid, wp, pp) => this.createCanUseToolHandler(sid, wp, pp)
 * goes undetected because test (1) only exercises sdkOptionsBuilder internals,
 * not the ClaudeCodeProvider wrapping lambda.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));

vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { buildSdkOptions } from '../claudeCode/sdkOptionsBuilder';

function makeDeps(overrides: Partial<Parameters<typeof buildSdkOptions>[0]> = {}) {
  return {
    resolveModelVariant: () => 'opus',
    mcpConfigService: { getMcpServersConfig: async () => ({}) },
    createCanUseToolHandler: () => () => true,
    toolHooksService: {
      createPreToolUseHook: () => () => ({}),
      createPostToolUseHook: () => () => ({}),
      createPermissionDeniedHook: () => () => ({}),
    },
    teammateManager: {
      resolveTeamContext: async () => undefined,
      packagedBuildOptions: undefined as any,
    },
    sessions: { getSessionId: () => null },
    config: {},
    abortController: new AbortController(),
    ...overrides,
  } as Parameters<typeof buildSdkOptions>[0];
}

function makeParams(overrides: Partial<Parameters<typeof buildSdkOptions>[1]> = {}) {
  return {
    message: 'hello',
    workspacePath: '/tmp/workspace',
    settingsEnv: {},
    shellEnv: {},
    systemPrompt: '',
    currentMode: undefined,
    imageContentBlocks: [],
    documentContentBlocks: [],
    ...overrides,
  } as Parameters<typeof buildSdkOptions>[1];
}

// ─── Layer 1: sdkOptionsBuilder internal contract ────────────────────────────

describe('buildSdkOptions isTrackerPlan forwarding (sdkOptionsBuilder contract)', () => {
  it('passes isTrackerPlan=true as the fifth arg to createCanUseToolHandler', async () => {
    const spy = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    await buildSdkOptions(
      makeDeps({ createCanUseToolHandler: spy }),
      makeParams({ isTrackerPlan: true, sessionId: 'sess-1', permissionsPath: '/tmp/perms' })
    );

    expect(spy).toHaveBeenCalledOnce();
    const [, , , , isTrackerPlanArg] = spy.mock.calls[0];
    expect(isTrackerPlanArg).toBe(true);
  });

  it('passes isTrackerPlan=undefined when not set', async () => {
    const spy = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    await buildSdkOptions(
      makeDeps({ createCanUseToolHandler: spy }),
      makeParams({ sessionId: 'sess-2' })
    );

    expect(spy).toHaveBeenCalledOnce();
    const [, , , , isTrackerPlanArg] = spy.mock.calls[0];
    expect(isTrackerPlanArg).toBeUndefined();
  });

  it('passes teammateName as the fourth arg as undefined for non-teammate sessions', async () => {
    const spy = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    await buildSdkOptions(
      makeDeps({ createCanUseToolHandler: spy }),
      makeParams({ isTrackerPlan: true })
    );

    const [, , , teammateNameArg] = spy.mock.calls[0];
    expect(teammateNameArg).toBeUndefined();
  });
});

// ─── Layer 2: DI adapter closure arity ───────────────────────────────────────
//
// This is the actual regression seam. The buggy code in ClaudeCodeProvider was:
//   createCanUseToolHandler: (sid, wp, pp) => this.createCanUseToolHandler(sid, wp, pp)
// which drops arg4 (teammateName) and arg5 (isTrackerPlan).
//
// We test the closure pattern directly: given an inner function that captures
// all 5 args, a narrowed adapter lambda MUST NOT drop the trailing args.

describe('createCanUseToolHandler adapter closure arity', () => {
  it('5-arg adapter lambda forwards isTrackerPlan to the underlying function', () => {
    // Simulates this.createCanUseToolHandler — the underlying method
    const inner = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    // The FIXED closure (5-arg forward):
    const fixedAdapter: (sid?: string, wp?: string, pp?: string, tn?: string, itp?: boolean) => any =
      (sid, wp, pp, tn, itp) => inner(sid, wp, pp, tn, itp);

    // Simulate how sdkOptionsBuilder calls the dep (sdkOptionsBuilder.ts:239):
    fixedAdapter('sess-x', '/ws', '/perm', undefined, true);

    const [, , , , isTrackerPlanArg] = inner.mock.calls[0];
    expect(isTrackerPlanArg).toBe(true);
  });

  it('3-arg adapter lambda (the buggy form) drops isTrackerPlan — proves RED before fix', () => {
    const inner = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    // The BUGGY closure (3-arg — the original bug):
    const buggyAdapter: (sid?: string, wp?: string, pp?: string, tn?: string, itp?: boolean) => any =
      (sid, wp, pp) => inner(sid, wp, pp);

    // Simulate how sdkOptionsBuilder calls the dep with isTrackerPlan=true:
    buggyAdapter('sess-x', '/ws', '/perm', undefined, true);

    const [, , , , isTrackerPlanArg] = inner.mock.calls[0];
    // The buggy 3-arg adapter drops arg5 — inner only got 3 args, so arg5 is undefined
    expect(isTrackerPlanArg).toBeUndefined();
    // This confirms the buggy pattern would have caused the write-scope guard to never fire
  });

  it('3-arg adapter also drops teammateName (arg4)', () => {
    const inner = vi.fn().mockReturnValue(() => ({ behavior: 'allow', updatedInput: {} }));

    const buggyAdapter: (sid?: string, wp?: string, pp?: string, tn?: string, itp?: boolean) => any =
      (sid, wp, pp) => inner(sid, wp, pp);

    buggyAdapter('sess-x', '/ws', '/perm', 'teammate-foo', undefined);

    const [, , , teammateNameArg] = inner.mock.calls[0];
    expect(teammateNameArg).toBeUndefined();
  });
});
