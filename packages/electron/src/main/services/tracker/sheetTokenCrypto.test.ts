import { describe, it, expect, vi, beforeEach } from 'vitest';

// The global electron mock (vitest.setup.ts) has no `safeStorage`. Provide one
// here whose encrypt/decrypt round-trip is reversible so we can assert behavior
// without an OS keychain. `vi.hoisted` lets us reference the mock in both the
// factory below and the test bodies.
const { mockSafeStorage } = vi.hoisted(() => ({
  mockSafeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`, 'utf8')),
    decryptString: vi.fn((buf: Buffer) => {
      const s = buf.toString('utf8');
      return s.startsWith('enc:') ? s.slice(4) : s;
    }),
  },
}));

vi.mock('electron', () => ({ safeStorage: mockSafeStorage }));
vi.mock('../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { encryptSheetToken, decryptSheetToken } from './sheetTokenCrypto';
import { logger } from '../../utils/logger';

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  mockSafeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`, 'utf8'));
  mockSafeStorage.decryptString.mockImplementation((buf: Buffer) => {
    const s = buf.toString('utf8');
    return s.startsWith('enc:') ? s.slice(4) : s;
  });
});

describe('encryptSheetToken', () => {
  it('returns base64 ciphertext (and no plaintext) when safeStorage is available', () => {
    const { enc, plain } = encryptSheetToken('my-secret-token');
    expect(enc).toBeDefined();
    expect(plain).toBeUndefined();
    // enc is the base64 of the encrypted buffer, not the raw token.
    expect(enc).not.toBe('my-secret-token');
    expect(enc).toBe(Buffer.from('enc:my-secret-token', 'utf8').toString('base64'));
  });

  it('returns an empty object for an empty token', () => {
    expect(encryptSheetToken('')).toEqual({});
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
  });

  it('falls back to { plain } (with a warning) when the keychain is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    const { enc, plain } = encryptSheetToken('my-secret-token');
    expect(enc).toBeUndefined();
    expect(plain).toBe('my-secret-token');
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    expect(logger.main.warn).toHaveBeenCalled();
  });
});

describe('decryptSheetToken', () => {
  it('round-trips an encrypted token', () => {
    const { enc } = encryptSheetToken('round-trip-token');
    expect(decryptSheetToken({ accessTokenEnc: enc })).toBe('round-trip-token');
  });

  it('falls back to the legacy plaintext accessToken', () => {
    expect(decryptSheetToken({ accessToken: 'legacy-plain' })).toBe('legacy-plain');
    expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('returns the keychain-unavailable fallback plaintext', () => {
    // When the keychain is unavailable, connect stored { plain } as accessToken;
    // decrypt should return it without touching safeStorage.
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    const { plain } = encryptSheetToken('degraded-token');
    expect(decryptSheetToken({ accessToken: plain })).toBe('degraded-token');
    expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('returns undefined for undefined input', () => {
    expect(decryptSheetToken(undefined)).toBeUndefined();
  });

  it('returns undefined when decryption throws', () => {
    mockSafeStorage.decryptString.mockImplementation(() => {
      throw new Error('keychain rejected');
    });
    expect(decryptSheetToken({ accessTokenEnc: 'Zm9v' })).toBeUndefined();
    expect(logger.main.error).toHaveBeenCalled();
  });

  it('warns and returns undefined when an encrypted token exists but the keychain is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(decryptSheetToken({ accessTokenEnc: 'Zm9v' })).toBeUndefined();
    expect(mockSafeStorage.decryptString).not.toHaveBeenCalled();
    expect(logger.main.warn).toHaveBeenCalled();
  });
});
