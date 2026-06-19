import { safeStorage } from 'electron';
import { logger } from '../../utils/logger';

/**
 * At-rest encryption for the Google Apps Script access token.
 *
 * Mirrors `CredentialService`'s use of Electron `safeStorage` (OS keychain):
 * encrypt when the keychain is available, fall back to plaintext (with a
 * warning) when it is not, so a missing keychain (some Linux setups) degrades
 * gracefully rather than breaking the sheet import.
 */

function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt a token for at-rest storage; returns base64 ciphertext, or the raw
 * token (with a warning) if the OS keychain is unavailable.
 */
export function encryptSheetToken(token: string): { enc?: string; plain?: string } {
  if (!token) return {};
  if (available()) {
    return { enc: safeStorage.encryptString(token).toString('base64') };
  }
  logger.main.warn('[sheetTokenCrypto] safeStorage unavailable — storing token unencrypted');
  return { plain: token };
}

/**
 * Decrypt whatever was stored. Accepts the new `accessTokenEnc` (base64) and
 * the legacy plaintext `accessToken` for backward compatibility.
 */
export function decryptSheetToken(
  stored: { accessTokenEnc?: string; accessToken?: string } | undefined,
): string | undefined {
  if (!stored) return undefined;
  if (stored.accessTokenEnc && available()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.accessTokenEnc, 'base64'));
    } catch (e) {
      logger.main.error('[sheetTokenCrypto] failed to decrypt token', e);
      return undefined;
    }
  }
  if (stored.accessTokenEnc && !available()) {
    logger.main.warn(
      '[sheetTokenCrypto] encrypted token present but safeStorage is unavailable — cannot decrypt',
    );
  }
  return stored.accessToken; // legacy plaintext (or fallback-stored)
}
