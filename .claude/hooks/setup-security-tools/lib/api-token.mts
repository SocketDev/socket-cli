/**
 * @file Single source of truth for "what's the Socket API token?" Resolution
 *   order (first hit wins): env → keychain. External fleet docs / workflow
 *   inputs / .env.example use SOCKET_API_TOKEN (the promoted name); internally
 *   we read both SOCKET_API_TOKEN and SOCKET_API_KEY because every Socket tool
 *   supports SOCKET_API_KEY (CLI, SDK, sfw, fleet scripts). Returns `undefined`
 *   when no token is found. Never throws — callers decide how to react (use
 *   free SFW, skip auth-gated install, prompt). **No `.env` / `.env.local`
 *   reads.** Dotfiles leak — they get accidentally committed, read by every dev
 *   tool that walks the project dir, swept into log scrapers. Tokens belong in
 *   env (for CI) or in the OS keychain (for dev local). **Module- scope
 *   cache.** Each successful resolution is memoized for the lifetime of the
 *   process. Reason: every `security find-generic-password` call on macOS
 *   triggers a fresh Keychain ACL check, which surfaces the "this app wants to
 *   access your keychain" dialog. A pre-commit hook + commit-msg hook +
 *   post-commit invocation can fire three keychain reads in 200ms — each one
 *   its own prompt. The cache collapses N reads per process to 1. Also
 *   propagates the resolved token into both env names so child processes
 *   inherit it regardless of which name they read.
 */

import { readTokenFromKeychain } from './token-storage.mts'

// Both names are checked at read time — first env hit wins. Storage layer
// (token-storage.mts) writes ONLY SOCKET_API_KEY to keep macOS Keychain
// rotation to a single auth prompt.
const ENV_NAMES = ['SOCKET_API_TOKEN', 'SOCKET_API_KEY'] as const

export interface TokenLookup {
  readonly token: string | undefined
  readonly source: 'env' | 'keychain' | undefined
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
export function resetApiTokenCacheForTesting(): void {
  cached = undefined
}

export function findApiToken(): TokenLookup {
  if (cached !== undefined) {
    return cached === null ? { token: undefined, source: undefined } : cached
  }

  for (let i = 0, { length } = ENV_NAMES; i < length; i += 1) {
    const name = ENV_NAMES[i]!
    const value = process.env[name]
    if (value) {
      propagateToEnv(value)
      cached = { token: value, source: 'env' }
      return cached
    }
  }

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
 * Populate both SOCKET_API_TOKEN and SOCKET_API_KEY in `process.env` so any
 * spawned child resolves a value under whichever name it reads. Idempotent —
 * already-set values are left alone (so the user's explicit env value isn't
 * clobbered by a keychain read).
 */
export function propagateToEnv(token: string): void {
  for (let i = 0, { length } = ENV_NAMES; i < length; i += 1) {
    const name = ENV_NAMES[i]!
    if (!process.env[name]) {
      process.env[name] = token
    }
  }
}
