import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock surface mirrors MetaAgentService.fullResponse.test.ts so MetaAgentService
// can be imported without pulling electron-app / node-pty into the graph. The
// tests below spy on the instance's private collaborators, so only the import
// needs to succeed.
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { create: vi.fn(), updateMetadata: vi.fn(), get: vi.fn(), delete: vi.fn() },
  AgentMessagesRepository: { list: vi.fn() },
  SessionFilesRepository: { getFilesBySession: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class { async initialize() {} },
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    parse: (id: string) => ({ provider: id.split(':')[0], model: id.split(':')[1], combined: id }),
    tryParse: (id: string) => {
      const i = typeof id === 'string' ? id.indexOf(':') : -1;
      return i > 0 ? { provider: id.slice(0, i), model: id.slice(i + 1) } : null;
    },
    getDefaultModelId: (provider: string) => `${provider}:default`,
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ subscribe: vi.fn() }),
}));
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: () => null,
  isExtensionAgentProvider: () => false,
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => ({ pushChange: vi.fn() }) }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/store', () => ({ getDefaultAIModel: () => null }));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (v: unknown) => v }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('./ai/AIService', () => ({ AIService: class {} }));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn(),
  setMetaAgentToolFns: vi.fn(),
  shutdownMetaAgentServer: vi.fn(),
}));
vi.mock('../metaAgentNotificationSignature', () => ({ computeNotificationSignature: vi.fn() }));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: (content: unknown) => (typeof content === 'string' ? content : ''),
  extractUserPrompts: () => ['original task'],
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

import { MetaAgentService } from '../MetaAgentService';

describe('MetaAgentService.runHeadlessReadOnlyTurn', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns failed when the child never reaches idle before timeout', async () => {
    const svc = MetaAgentService.getInstance();
    vi.spyOn(svc as any, 'createChildSessionInternal').mockResolvedValue({ sessionId: 'child-1' });
    vi.spyOn(svc as any, 'getSessionStatusRow').mockResolvedValue({ status: 'running' });
    vi.spyOn(svc as any, 'buildSessionResultData').mockResolvedValue({ status: 'running', fullResponse: '' });
    const cleanup = vi.spyOn(svc as any, 'cleanupChildSession').mockResolvedValue(undefined);

    const res = await svc.runHeadlessReadOnlyTurn('/ws', 'find relevant files', { timeoutMs: 30, pollMs: 10 });

    expect(res.status).toBe('failed');
    expect(cleanup).toHaveBeenCalledWith('child-1');
  });

  it('halts the still-running agent BEFORE deleting the session on timeout', async () => {
    // Regression: a headless turn that overruns timeoutMs used to delete its
    // session row while the agent kept streaming, so every late
    // ai_agent_messages write FK-failed against the deleted session (and the
    // orphaned agent burned tokens on discarded output). The graceful halt must
    // run first so the agent stops writing before the row is gone.
    const svc = MetaAgentService.getInstance();
    vi.spyOn(svc as any, 'createChildSessionInternal').mockResolvedValue({ sessionId: 'child-timeout' });
    vi.spyOn(svc as any, 'getSessionStatusRow').mockResolvedValue({ status: 'running' });
    vi.spyOn(svc as any, 'buildSessionResultData').mockResolvedValue({ status: 'running', fullResponse: '' });
    const interrupt = vi.spyOn(svc as any, 'interruptChildSession').mockResolvedValue(undefined);
    const cleanup = vi.spyOn(svc as any, 'cleanupChildSession').mockResolvedValue(undefined);

    const res = await svc.runHeadlessReadOnlyTurn('/ws', 'find relevant files', { timeoutMs: 30, pollMs: 10 });

    expect(res.status).toBe('failed'); // no partial text gathered
    expect(interrupt).toHaveBeenCalledWith('child-timeout');
    expect(cleanup).toHaveBeenCalledWith('child-timeout');
    expect(interrupt.mock.invocationCallOrder[0]).toBeLessThan(cleanup.mock.invocationCallOrder[0]);
  });

  it('returns partial text gathered so far when it times out mid-run', async () => {
    // Instead of discarding a timed-out run, surface whatever the agent gathered
    // before the deadline so the caller can persist it with a "not exhaustive"
    // note.
    const svc = MetaAgentService.getInstance();
    vi.spyOn(svc as any, 'createChildSessionInternal').mockResolvedValue({ sessionId: 'child-partial' });
    vi.spyOn(svc as any, 'getSessionStatusRow').mockResolvedValue({ status: 'running' });
    vi.spyOn(svc as any, 'buildSessionResultData').mockResolvedValue({
      status: 'running',
      fullResponse: 'Relevant: Foo.ts - the thing',
    });
    const interrupt = vi.spyOn(svc as any, 'interruptChildSession').mockResolvedValue(undefined);
    vi.spyOn(svc as any, 'cleanupChildSession').mockResolvedValue(undefined);

    const res = await svc.runHeadlessReadOnlyTurn('/ws', 'find relevant files', { timeoutMs: 30, pollMs: 10 });

    expect(res).toEqual({ status: 'partial', text: 'Relevant: Foo.ts - the thing' });
    expect(interrupt).toHaveBeenCalledWith('child-partial');
  });

  it('returns the fullResponse text and read tool scope when the child reaches idle', async () => {
    const svc = MetaAgentService.getInstance();
    const create = vi.spyOn(svc as any, 'createChildSessionInternal').mockResolvedValue({ sessionId: 'child-2' });
    vi.spyOn(svc as any, 'getSessionStatusRow').mockResolvedValue({ status: 'idle' });
    vi.spyOn(svc as any, 'buildSessionResultData').mockResolvedValue({ status: 'idle', fullResponse: 'RELEVANT: Foo.ts' });
    vi.spyOn(svc as any, 'cleanupChildSession').mockResolvedValue(undefined);

    const res = await svc.runHeadlessReadOnlyTurn('/ws', 'find relevant files', { timeoutMs: 1000, pollMs: 10, model: 'm:x' });

    expect(res).toEqual({ status: 'done', text: 'RELEVANT: Foo.ts' });
    // Spawned read-only with the prompt + model forwarded.
    const args = create.mock.calls[0][2] as any;
    expect(args.toolScope).toBe('read');
    expect(args.prompt).toBe('find relevant files');
    expect(args.model).toBe('m:x');
  });

  it('returns failed (does not throw) when child creation throws', async () => {
    const svc = MetaAgentService.getInstance();
    vi.spyOn(svc as any, 'createChildSessionInternal').mockRejectedValue(new Error('boom'));
    const res = await svc.runHeadlessReadOnlyTurn('/ws', 'x', { timeoutMs: 1000, pollMs: 10 });
    expect(res).toEqual({ status: 'failed', text: '' });
  });
});
