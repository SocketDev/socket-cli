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
 */

import { readTokenFromKeychain } from './token-storage.mts'

const CANONICAL = 'SOCKET_API_TOKEN'
const LEGACY = 'SOCKET_API_KEY'

export interface TokenLookup {
  readonly token: string | undefined
  readonly source: 'env-canonical' | 'env-legacy' | 'keychain' | undefined
}

export function findApiToken(): TokenLookup {
  // 1. Env (canonical first, then legacy alias).
  const envCanonical = process.env[CANONICAL]
  if (envCanonical) {
    return { token: envCanonical, source: 'env-canonical' }
  }
  const envLegacy = process.env[LEGACY]
  if (envLegacy) {
    return { token: envLegacy, source: 'env-legacy' }
  }

  // 2. OS keychain.
  const fromKeychain = readTokenFromKeychain()
  if (fromKeychain) {
    return { token: fromKeychain, source: 'keychain' }
  }

  return { token: undefined, source: undefined }
}
