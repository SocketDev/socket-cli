/**
 * @file Pre-pnpm provisioner for the `@actions/cache` npm package — the one
 *   impure step of the fleet cache CLIs' fallback module tier
 *   (scripts/fleet/cache/cache-cli.mts). The cache restore that warms the
 *   pnpm store runs BEFORE `pnpm install`, and the Rust-only CI jobs never
 *   install at all, so when the repo's node_modules cannot resolve the
 *   package this provisioner installs the catalog-pinned version into a
 *   scratch prefix (RUNNER_TEMP) with the runner's system npm. `--prefix`
 *   keeps the install fully outside the repo — no lockfile churn, no
 *   package.json edits. Same constraint as the sibling bootstrap
 *   provisioners: runs before node_modules exists, so only `node:` builtins
 *   and the dependency-free bootstrap-common helpers are imported.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap, no lib spawn wrapper on disk yet.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

import { IS_WINDOWS } from './lib/bootstrap-common.mjs'

/**
 * Install a package into `prefixDir` with the system npm. Returns the
 * spawn's exit status; a failed spawn returns null. The caller owns the
 * loud-failure message. `npmArgs` comes from the pure composeNpmInstallArgs
 * helper so the argv is unit-testable there.
 */
export function provisionWithNpm(prefixDir, npmArgs) {
  mkdirSync(prefixDir, { recursive: true })
  const result = spawnSync(IS_WINDOWS ? 'npm.cmd' : 'npm', npmArgs, {
    cwd: prefixDir,
    encoding: 'utf8',
    // .cmd files need a shell on Windows; everywhere else a direct spawn.
    shell: IS_WINDOWS,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  return result.status
}
