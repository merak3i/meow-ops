// Read an optional Cursor Team Admin API credential without placing it in the
// repository, helper response, or process arguments. Explicit process injection
// overrides Keychain; an explicitly empty value disables credential lookup.
import { execFileSync } from 'node:child_process';

export const CURSOR_ADMIN_KEYCHAIN_SERVICE = 'com.meow-ops.cursor-admin-api';
export const CURSOR_ADMIN_KEYCHAIN_ACCOUNT = 'meow-ops';

export function readCursorAdminApiKey({ env = process.env, run = execFileSync } = {}) {
  if (typeof env.CURSOR_ADMIN_API_KEY === 'string') return env.CURSOR_ADMIN_API_KEY.trim() || null;
  try {
    const value = run('/usr/bin/security', [
      'find-generic-password', '-s', CURSOR_ADMIN_KEYCHAIN_SERVICE,
      '-a', CURSOR_ADMIN_KEYCHAIN_ACCOUNT, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 4096 });
    const key = String(value).trim();
    return key || null;
  } catch {
    return null;
  }
}
