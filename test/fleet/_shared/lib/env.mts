/**
 * @file Fleet-canonical env-var helpers for tests. Pure functions, no side
 *   effects — safe to import from anywhere in `test/`. Mostly thin shims over
 *   `process.env` that encode the "set + truthy" convention the fleet uses for
 *   opt-in / opt-out test flags (`SOCKET_LIB_RUN_NETWORK_TESTS=1`,
 *   `SOCKET_SKIP_KEYCHAIN_LIVE_TESTS=1`, etc.). Pairs with `./platform.mts`
 *   (re-exports `IS_CI` built on top of this module's `envFlag`).
 */
import process from 'node:process'

/**
 * True when `process.env[name]` is set to a truthy value. The fleet convention
 * recognizes `'1'`, `'true'`, `'yes'`, `'on'` (case-insensitive) as truthy;
 * everything else — including unset, empty string, `'0'`, `'false'`, `'no'`,
 * `'off'` — is falsy. Lets opt-in flags use either `FLAG=1` or `FLAG=true`
 * interchangeably instead of forcing call sites to spell out
 * `process.env['FLAG'] === '1' || process.env['FLAG'] === 'true'`.
 *
 * @example
 *   ;```ts
 *   import { envFlag } from '../../fleet/_shared/lib/env.mts'
 *
 *   if (envFlag('SOCKET_LIB_RUN_NETWORK_TESTS')) {
 *     // run the live-registry suite
 *   }
 *   ```
 */
export function envFlag(name: string): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return false
  }
  const lower = raw.trim().toLowerCase()
  return lower === '1' || lower === 'on' || lower === 'true' || lower === 'yes'
}
