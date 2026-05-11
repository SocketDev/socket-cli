/**
 * Update: two-pass taze to apply the fleet's maturity policy
 * correctly.
 *
 *   Pass 1: default config (.config/taze.config.mts) —
 *     non-Socket deps respect maturityPeriod: 7.
 *
 *   Pass 2: CLI-flag override — Socket-owned scopes only,
 *     maturityPeriod: 0. taze's config auto-discovery is
 *     path-based and doesn't support a --config override, so
 *     the second pass uses `--include <scopes> --maturity-
 *     period 0` flags instead of a second config file.
 *
 *   Pass 3: pnpm install to refresh the lockfile against the
 *     updated package.json.
 *
 * SOCKET_SCOPES below MUST match the `exclude` list in
 * .config/taze.config.mts — drift causes double-bumps or
 * misses.
 *
 * This is a reference script. Consuming repos can drop it into
 * their own scripts/ dir and wire it in via a `"update": "node
 * scripts/update.mts"` package.json entry.
 */
import { spawn } from '@socketsecurity/lib/spawn/core'

async function run(cmd: string, args: string[]): Promise<boolean> {
  try {
    await spawn(cmd, args, { stdio: 'inherit' })
    return true
  } catch (e) {
    process.exitCode = (e as { code?: number }).code ?? 1
    return false
  }
}

/* Socket-owned scopes — keep in lockstep with the exclude list
 * in .config/taze.config.mts. */
const SOCKET_SCOPES = [
  '@socketregistry/*',
  '@socketsecurity/*',
  '@socketdev/*',
  'socket-*',
  'ecc-agentshield',
  'sfw',
]

const steps: Array<[string, string[]]> = [
  /* Pass 1 — third-party deps, respects the 7-day cooldown.
   *
   * `--maturity-period 7` MUST be passed on the CLI even though
   * the config file (.config/taze.config.mts) sets the same
   * value. Taze's CLI default for this flag is 0, and CLI
   * defaults override config — without this flag, the cooldown
   * is silently disabled. */
  ['pnpm', ['exec', 'taze', '--maturity-period', '7', '--write']],
  /* Pass 2 — Socket deps, no cooldown. --include is comma-separated. */
  [
    'pnpm',
    [
      'exec',
      'taze',
      '--include',
      SOCKET_SCOPES.join(','),
      '--maturity-period',
      '0',
      '--write',
    ],
  ],
  /* Pass 3 — resync lockfile against the updated package.json. */
  ['pnpm', ['install']],
]

for (const [cmd, args] of steps) {
  if (!(await run(cmd, args))) {
    break
  }
}
