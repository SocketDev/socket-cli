/**
 * @fileoverview Single source of truth for "what's the Socket API token?"
 *
 * Resolution order (first hit wins):
 *
 *   1. `SOCKET_API_TOKEN` env var (canonical fleet name).
 *   2. `SOCKET_API_KEY` env var (legacy alias; deprecated, kept readable
 *      for one cycle so existing dev setups don't break in lockstep with
 *      the rename).
 *   3. OS keychain (macOS Keychain / Linux libsecret / Windows
 *      CredentialManager).
 *
 * Returns `undefined` when no token is found. Never throws — callers
 * decide how to react (use free SFW, skip auth-gated install, prompt).
 *
 * **No `.env` / `.env.local` reads.** Dotfiles leak — they get
 * accidentally committed, read by every dev tool that walks the
 * project dir, swept into log scrapers. Tokens belong in env (for
 * CI) or in the OS keychain (for dev local). The canonical
 * resolution chain stays explicit: env → keychain → prompt.
 *
 * **Module-scope cache.** Each successful resolution is memoized for
 * the lifetime of the process. Reason: every `security find-generic-
 * password` call on macOS triggers a fresh Keychain ACL check, which
 * surfaces the "this app wants to access your keychain" dialog. A
 * pre-commit hook + commit-msg hook + post-commit invocation can fire
 * three keychain reads in 200ms — each one its own prompt. The cache
 * collapses N reads per process to 1. Also propagates the resolved
 * token into `process.env.SOCKET_API_TOKEN` so child processes
 * (spawned by the same hook chain) inherit it instead of re-querying.
 */

import { readTokenFromKeychain } from './token-storage.mts'

const CANONICAL = 'SOCKET_API_TOKEN'
const LEGACY = 'SOCKET_API_KEY'

export interface TokenLookup {
  readonly token: string | undefined
  readonly source: 'env-canonical' | 'env-legacy' | 'keychain' | undefined
}

// Module-scope cache: the result of the FIRST findApiToken() call is
// reused for every subsequent call in the same process. A `null`
// sentinel means "we already looked and found nothing" — distinct
// from `undefined` which means "not yet looked." Otherwise a
// not-found case would re-hit the keychain on every call.
let cached: TokenLookup | null | undefined

export function findApiToken(): TokenLookup {
  if (cached !== undefined) {
    return cached === null ? { token: undefined, source: undefined } : cached
  }

  // 1. Env (canonical first, then legacy alias).
  const envCanonical = process.env[CANONICAL]
  if (envCanonical) {
    // Mirror to the legacy slot if it's empty — keeps spawned children
    // that resolve the legacy name working without their own keychain
    // round-trip. See the keychain branch below for the same shape.
    propagateToEnv(envCanonical)
    cached = { token: envCanonical, source: 'env-canonical' }
    return cached
  }
  const envLegacy = process.env[LEGACY]
  if (envLegacy) {
    propagateToEnv(envLegacy)
    cached = { token: envLegacy, source: 'env-legacy' }
    return cached
  }

  // 2. OS keychain.
  const fromKeychain = readTokenFromKeychain()
  if (fromKeychain) {
    propagateToEnv(fromKeychain)
    cached = { token: fromKeychain, source: 'keychain' }
    return cached
  }

  cached = null
  return { token: undefined, source: undefined }
}

/**
 * Populate BOTH `SOCKET_API_TOKEN` and `SOCKET_API_KEY` in
 * `process.env` so any spawned child — whether it resolves the
 * canonical or the legacy name — inherits the value and skips its
 * own keychain read. Mirrors the WRITE_SLOTS behavior in
 * token-storage.mts: writes paint both slots, reads only the
 * canonical one. The keychain-side legacy slot stays untouched here;
 * this is purely an in-process env mirror.
 *
 * Idempotent — already-set values are left alone (so the user's
 * explicit env value isn't clobbered by a keychain read).
 */
function propagateToEnv(token: string): void {
  if (!process.env[CANONICAL]) {
    process.env[CANONICAL] = token
  }
  if (!process.env[LEGACY]) {
    process.env[LEGACY] = token
  }
}

/**
 * Clear the module cache. Test-only escape hatch — production code
 * should never call this. Used by `--rotate` flows that need to
 * re-prompt after wiping the keychain entry.
 */
export function _resetApiTokenCacheForTesting(): void {
  cached = undefined
}
