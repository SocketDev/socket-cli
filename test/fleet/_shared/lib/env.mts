/**
 * @file Fleet-canonical env-var helpers for tests. Pure functions, no side
 *   effects — safe to import from anywhere in `test/`. Mostly thin shims over
 *   `process.env` that encode the "set + truthy" convention the fleet uses for
 *   opt-in / opt-out test flags (`SOCKET_LIB_RUN_NETWORK_TESTS=1`,
 *   `SOCKET_SKIP_KEYCHAIN_LIVE_TESTS=1`, etc.). Pairs with `./platform.mts`
 *   (re-exports `IS_CI` built on top of this module's `envFlag`).
 *   `isolatedHomeEnv` is the HOME-side twin of
 *   `.git-hooks/_shared/isolate-git-env.mts`: that one neutralizes the git
 *   discovery vars, this one neutralizes the per-user toolchain roots.
 */
import path from 'node:path'
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

// Absolute per-user roots their tool reads INSTEAD of deriving one from `HOME`.
// An inherited value here silently defeats a perfect `HOME` override, so the
// isolation is the DELETE, not the set: `PNPM_HOME` from a shell profile wins
// over `HOME=<tmp>` outright. Only path-valued roots belong here — Homebrew's
// policy flags (`HOMEBREW_NO_AUTO_UPDATE`, `HOMEBREW_REQUIRE_TAP_TRUST`, …) are
// fleet hardening and stay, and the git/gh config vars are owned by
// `isolateGitEnv` and by the call sites that set them per-spawn.
const HOME_OUTRANKING_VARS: readonly string[] = [
  'ASDF_DATA_DIR',
  'ASDF_DIR',
  'BUN_INSTALL',
  'CARGO_HOME',
  'COREPACK_HOME',
  'FNM_DIR',
  'GOCACHE',
  'GOENV',
  'GOMODCACHE',
  'GOPATH',
  'HOMEBREW_CACHE',
  'HOMEBREW_CELLAR',
  'HOMEBREW_LOGS',
  'HOMEBREW_PREFIX',
  'HOMEBREW_REPOSITORY',
  'HOMEBREW_TEMP',
  'MISE_CACHE_DIR',
  'MISE_CONFIG_DIR',
  'MISE_DATA_DIR',
  'MISE_STATE_DIR',
  'NUGET_PACKAGES',
  'NVM_DIR',
  'PNPM_HOME',
  'RUSTUP_HOME',
  'UV_CACHE_DIR',
  'UV_PYTHON_INSTALL_DIR',
  'UV_TOOL_DIR',
  'VOLTA_HOME',
  'YARN_CACHE_FOLDER',
  'YARN_GLOBAL_FOLDER',
]

// npm and pnpm project EVERY config key — `.npmrc` entries included — into
// `npm_config_<key>` for their child processes, so the family is open-ended and
// has to be enumerated from the live env rather than listed. `npm run` alone
// exports `npm_config_cache`, `npm_config_prefix`, `npm_config_userconfig` and
// `npm_config_globalconfig`, each of which outranks `<home>/.npmrc`.
const NPM_CONFIG_PREFIX = 'npm_config_'

/**
 * An env overlay that pins a child process's per-user state to `dir`. Spread it
 * AFTER `...process.env` so the deletions land last; the returned object marks
 * each leaky variable `undefined`, which Node's `child_process` drops from the
 * child's environment entirely.
 *
 * CHILD environments only. Never `Object.assign` the result into `process.env`
 * — assigning `undefined` there stores the STRING `'undefined'`, which is worse
 * than the value it replaced. In-process tests save and restore `HOME`
 * themselves.
 *
 * @example
 *   ;```ts
 *   import { isolatedHomeEnv } from '../../fleet/_shared/lib/env.mts'
 *
 *   spawnSync(process.execPath, [script], {
 *     env: { ...process.env, ...isolatedHomeEnv(tmpHome) },
 *   })
 *   ```
 */
export function isolatedHomeEnv(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: dir,
    USERPROFILE: dir,
    XDG_CACHE_HOME: path.join(dir, '.cache'),
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_DATA_HOME: path.join(dir, '.local', 'share'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
  }
  for (let i = 0, { length } = HOME_OUTRANKING_VARS; i < length; i += 1) {
    env[HOME_OUTRANKING_VARS[i]!] = undefined
  }
  const names = Object.keys(process.env)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name.toLowerCase().startsWith(NPM_CONFIG_PREFIX)) {
      env[name] = undefined
    }
  }
  return env
}
