/**
 * @file Neutralize the inherited git environment so a test's `git` spawns can
 *   never touch the live repo. Importing this module runs the SAFE default
 *   (strip discovery vars) as a side effect; call `isolateGitEnv({ … })` for
 *   the stronger variant. Why this is load-bearing: when a suite runs from the
 *   pre-commit / pre-push hook (or just inherits the ambient env), git exports
 *   `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` pointing at THE LIVE repo,
 *   and git honors those above cwd-based discovery. A fixture that does `git
 *   init` + `git config user.email …` in a `cwd: tmpDir` then escapes onto the
 *   real `.git/config` and HEAD — observed damage: `core.bare=true` (breaks
 *   every worktree op with "must be run in a work tree"), a junk
 *   `test@example.com` identity, and stray commits on the working branch. Two
 *   consumers:
 *
 *   - `node --test` git-fixture suites (`.git-hooks/fleet/test/*`, etc.) do NOT
 *     load the vitest setup, so each imports this module — the side-effect
 *     default (strip-only) stops the escape while leaving each fixture free to
 *     scope its own `GIT_CONFIG_GLOBAL` per-spawn (the signing-gate tests need
 *     that). `no-unisolated-git-fixture-guard` recognizes the import.
 *   - vitest, via `setupFiles` (`test/scripts/fleet/setup.mts`), calls
 *     `isolateGitEnv({ pinConfigToNull: true })` for the stronger form (no
 *     fixture there manipulates a controlled global config). Lives in
 *     `.git-hooks/_shared/` (alongside `git-identity.mts`) so the git-hook test
 *     tree imports it within-tree; the vitest setup reaches it cross-tree (both
 *     cascade together).
 */

import process from 'node:process'

// The git discovery + context vars that override cwd-based repo resolution.
// Stripping them forces every `git` spawn to resolve from its own cwd, which
// is what prevents a tmp-fixture's writes from escaping onto the live repo.
const LEAKY_GIT_VARS: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
]

export interface IsolateGitEnvOptions {
  /**
   * Also pin `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` to `/dev/null` so `git
   * config` (without `--local`) can't reach a real config file at all.
   * Stronger, but it OVERRIDES any per-spawn global a fixture sets — only use
   * it where no fixture manipulates a controlled global config (vitest). The
   * strip alone already prevents escape; this is belt-and-suspenders.
   */
  pinConfigToNull?: boolean | undefined
}

/**
 * Strip the inherited git context vars (always). Optionally pin the config
 * files to `/dev/null`. Idempotent — safe to call or import more than once.
 */
export function isolateGitEnv(options: IsolateGitEnvOptions = {}): void {
  for (let i = 0, { length } = LEAKY_GIT_VARS; i < length; i += 1) {
    delete process.env[LEAKY_GIT_VARS[i]!]
  }
  if (options.pinConfigToNull) {
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null'
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null'
  }
}

// Side-effect default for the bare `import '…/isolate-git-env.mts'` form: the
// safe strip-only isolation. Consumers wanting the stronger pin call
// isolateGitEnv({ pinConfigToNull: true }) explicitly.
isolateGitEnv()
