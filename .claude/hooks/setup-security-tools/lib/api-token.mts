/**
 * @file Single source of truth for "what's the Socket API token?" Resolution
 *   order (first hit wins):
 *
 *   1. `SOCKET_API_KEY` env var (primary — universally supported across Socket
 *      tools; what setup-security-tools' install.mts writes to both the OS
 *      keychain and the shell-rc bridge).
 *   2. `SOCKET_API_TOKEN` env var (forward-canonical name targeted by fleet docs /
 *      workflow inputs / .env.example; accepted so consumers that set the
 *      forward-canonical name explicitly still resolve a value).
 *   3. OS keychain (macOS Keychain / Linux libsecret / Windows CredentialManager).
 *      Returns `undefined` when no token is found. Never throws — callers
 *      decide how to react (use free SFW, skip auth-gated install, prompt).
 *      **No `.env` / `.env.local` reads.** Dotfiles leak — they get
 *      accidentally committed, read by every dev tool that walks the project
 *      dir, swept into log scrapers. Tokens belong in env (for CI) or in the OS
 *      keychain (for dev local). The canonical resolution chain stays explicit:
 *      env → keychain → prompt. **Module-scope cache.** Each successful
 *      resolution is memoized for the lifetime of the process. Reason: every
 *      `security find-generic- password` call on macOS triggers a fresh
 *      Keychain ACL check, which surfaces the "this app wants to access your
 *      keychain" dialog. A pre-commit hook + commit-msg hook + post-commit
 *      invocation can fire three keychain reads in 200ms — each one its own
 *      prompt. The cache collapses N reads per process to 1. Also propagates
 *      the resolved token into `process.env.SOCKET_API_KEY` so child processes
 *      (spawned by the same hook chain) inherit it instead of re-querying.
 */

import { readTokenFromKeychain } from './token-storage.mts'

const PRIMARY = 'SOCKET_API_TOKEN'
const FORWARD_CANONICAL = 'SOCKET_API_TOKEN'

export interface TokenLookup {
  readonly token: string | undefined
  readonly source:
    | 'env-primary'
    | 'env-forward-canonical'
    | 'keychain'
    | undefined
}

// Module-scope cache: the result of the FIRST findApiToken() call is
// reused for every subsequent call in the same process. A `null`
// sentinel means "we already looked and found nothing" — distinct
// from `undefined` which means "not yet looked." Otherwise a
// not-found case would re-hit the keychain on every call.
let cached: TokenLookup | null | undefined

/**
 * Clear the module cache. Test-only escape hatch — production code should never
 * call this. Used by `--rotate` flows that need to re-prompt after wiping the
 * keychain entry.
 */
export function _resetApiTokenCacheForTesting(): void {
  cached = undefined
}

export function findApiToken(): TokenLookup {
  if (cached !== undefined) {
    return cached === null ? { token: undefined, source: undefined } : cached
  }

  // 1. Env — primary slot first, then forward-canonical fallback.
  const envPrimary = process.env[PRIMARY]
  if (envPrimary) {
    propagateToEnv(envPrimary)
    cached = { token: envPrimary, source: 'env-primary' }
    return cached
  }
  const envForwardCanonical = process.env[FORWARD_CANONICAL]
  if (envForwardCanonical) {
    propagateToEnv(envForwardCanonical)
    cached = { token: envForwardCanonical, source: 'env-forward-canonical' }
    return cached
  }

  // 2. OS keychain.
  const fromKeychain = readTokenFromKeychain()
  if (fromKeychain) {
    propagateToEnv(fromKeychain)
    cached = { token: fromKeychain, source: 'keychain' }
    return cached
  }

  cached = undefined
  return { token: undefined, source: undefined }
}

/**
 * Populate BOTH `SOCKET_API_KEY` (primary) and `SOCKET_API_TOKEN`
 * (forward-canonical) in `process.env` so any spawned child resolves a value
 * under whichever name it reads. The keychain-side mirror was removed at the
 * storage layer (one stored slot = one macOS Keychain auth prompt), but env
 * propagation here is free in-process and helps consumers that haven't migrated
 * to SOCKET_API_KEY yet.
 *
 * Idempotent — already-set values are left alone (so the user's explicit env
 * value isn't clobbered by a keychain read).
 */
export function propagateToEnv(token: string): void {
  if (!process.env[PRIMARY]) {
    process.env[PRIMARY] = token
  }
  if (!process.env[FORWARD_CANONICAL]) {
    process.env[FORWARD_CANONICAL] = token
  }
}
