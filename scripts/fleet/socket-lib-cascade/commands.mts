/**
 * @file The socket-lib cascade's deferred COMMAND sequences: the wheelhouse
 *   catalog bump, the downstream release-pipeline trigger, the socket-cli
 *   branch refresh, and the runner that walks a sequence in a working
 *   directory. The orchestrator never hand-rolls a release — it only sequences
 *   the owning repos' own scripts. Backs `../socket-lib-cascade.mts`.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runInherit } from '../publish-infra/shared.mts'
import { LIB_PKG, SOCKET_CLI_BRANCHES } from './stages.mts'

const logger = getDefaultLogger()

/**
 * One deferred shell command in a stage's command sequence: the binary plus
 * its argv. Named once here so every command-sequence function below shares
 * the shape instead of repeating an inline object type.
 */
export interface CommandSpec {
  readonly args: string[]
  readonly cmd: string
}

/**
 * A command runner, injected so `runDeferred` is testable without a real
 * subprocess. Matches `runInherit`'s signature with its optional env param
 * dropped — one seam convention for spawn-touching fleet code, matching
 * `GitExec` in `backup-branches/prune.mts`.
 */
export type CommandRunner = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<number>

/**
 * Run a sequence of deferred commands in a working directory, forwarding stdio.
 * Under --dry-run the commands are printed, not executed. Returns true when
 * every command exited zero; stops at (and reports) the first non-zero exit,
 * leaving later commands unrun.
 */
export async function runDeferred(
  commands: readonly CommandSpec[],
  config: { cwd: string; dryRun: boolean },
  run: CommandRunner = runInherit,
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as typeof config
  for (const { args, cmd } of commands) {
    const line = `${cmd} ${args.join(' ')}`.trim()
    if (cfg.dryRun) {
      logger.log(`  [dry-run] would run (in ${cfg.cwd}): ${line}`)
      continue
    }
    logger.log(`  running (in ${cfg.cwd}): ${line}`)
    const code = await run(cmd, args, cfg.cwd)
    if (code !== 0) {
      logger.fail(`  command failed with exit ${code}: ${line}`)
      return false
    }
  }
  return true
}

/**
 * The wheelhouse catalog stage's deferred command sequence, in order.
 *
 * `targetVersion` is trusted to be a real version string: an empty string
 * produces a trailing-`@` package spec (`@socketsecurity/lib@`) here rather
 * than failing loud. Validating that belongs to the caller
 * (`drive.mts`'s `driveStage`, which resolves `targetVersion` before calling
 * in), not this pure command-list builder — this file's test pins the
 * current pass-through behavior rather than guarding against it here.
 */
export function catalogCommands(targetVersion: string): CommandSpec[] {
  return [
    {
      args: [
        'scripts/repo/bump-catalog-tool.mts',
        `${LIB_PKG}@${targetVersion}`,
      ],
      cmd: 'node',
    },
    { args: ['scripts/fleet/fix.mts'], cmd: 'node' },
    { args: ['run', 'dogfood'], cmd: 'pnpm' },
    { args: ['install', '--lockfile-only'], cmd: 'pnpm' },
    {
      args: ['scripts/fleet/check/stable-aliases-match-base.mts'],
      cmd: 'node',
    },
    {
      args: ['scripts/fleet/check/baseline-catalog-deps-are-covered.mts'],
      cmd: 'node',
    },
    { args: ['scripts/fleet/land-work.mts', '--commit'], cmd: 'node' },
  ]
}

/**
 * The deterministic trigger the orchestrator runs in a downstream release repo:
 * absorb the published upstream, then run that repo's own release-pipeline
 * which HARD-STOPS at its bump-stop needing the repo's X.Y.Z. Naming that
 * version and approving the staged package stay USER gates; everything up to
 * bump-stop is automatic.
 */
export function downstreamTriggerCommands(): CommandSpec[] {
  return [
    { args: ['run', 'update'], cmd: 'pnpm' },
    { args: ['scripts/fleet/release-pipeline.mts'], cmd: 'node' },
  ]
}

/**
 * The socket-cli push-only stage's deferred command sequence over both
 * branches, in order.
 */
export function socketCliCommands(): CommandSpec[] {
  const out: CommandSpec[] = []
  for (let i = 0, { length } = SOCKET_CLI_BRANCHES; i < length; i += 1) {
    const branch = SOCKET_CLI_BRANCHES[i]!
    out.push(
      { args: ['fetch', 'origin'], cmd: 'git' },
      { args: ['checkout', branch], cmd: 'git' },
      { args: ['pull', '--ff-only', 'origin', branch], cmd: 'git' },
      { args: ['run', 'update'], cmd: 'pnpm' },
      { args: ['scripts/fleet/land-work.mts', '--commit'], cmd: 'node' },
      { args: ['push', 'origin', branch], cmd: 'git' },
    )
  }
  return out
}
