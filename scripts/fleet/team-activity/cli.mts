#!/usr/bin/env node
/**
 * @file Team-activity monitor CLI — the deterministic engine behind the
 *   recurring team review-follow-up loop. Discovers open PRs AND issues the
 *   team owns across every configured repo (no date floor), tracks watched
 *   review threads, and reports via the fail-LOUD exit contract: exit 0, "SCAN:
 *   all quiet — …" nothing changed; the loop ends the turn exit 0, "SCAN:
 *   CHANGES" + bullets the loop investigates/handles exit 1,
 *   heartbeat/auth/config failure the loop reports the fix MCP-free by design:
 *   GitHub via `gh`, everything testable through the injected `GhRunner`.
 *   Slack/Linear steps live in the skill layer (later phases), which hands this
 *   engine input files to consume. Usage: node
 *   scripts/fleet/team-activity/cli.mts [scan] <config.json> [--quiet]
 */

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- sequential CLI probe loop; sync keeps the state machine trivial and the process short-lived.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { refreshGhHeartbeat } from '../gh-heartbeat.mts'
import { loadConfig } from './lib/config.mts'
import { renderReport, scanChanged } from './lib/render.mts'
import { runScan } from './lib/scan.mts'
import { loadState, writeState } from './lib/state.mts'

import type { GhRunner } from './lib/types.mts'

const logger = getDefaultLogger()

export function makeGhRunner(cwd: string): GhRunner {
  return args => {
    const result = spawnSync('gh', args, { cwd, stdio: 'pipe' })
    if (result.status !== 0) {
      return undefined
    }
    return String(result.stdout)
  }
}

export interface ParsedArgv {
  readonly command: string
  readonly configPath: string | undefined
  readonly quiet: boolean
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const quiet = argv.includes('--quiet')
  const positional = argv.filter(a => !a.startsWith('--'))
  const commands = new Set(['init', 'render', 'scan'])
  if (positional[0] && commands.has(positional[0])) {
    return { command: positional[0], configPath: positional[1], quiet }
  }
  return { command: 'scan', configPath: positional[0], quiet }
}

function runScanCommand(options: {
  configPath: string
  quiet: boolean
}): number {
  const opts = { __proto__: null, ...options } as typeof options
  let config
  try {
    config = loadConfig(opts.configPath)
  } catch (e) {
    logger.fail(`[team-activity] ${(e as Error).message}`)
    return 1
  }
  const heartbeat = refreshGhHeartbeat()
  if (!heartbeat.stamped) {
    logger.fail(`[team-activity] ${heartbeat.reason}`)
    return 1
  }
  const now = new Date().toISOString()
  const state = loadState(opts.configPath, now)
  const report = runScan(config, state, makeGhRunner(process.cwd()))
  state.scannedAt = now
  writeState(opts.configPath, state)
  const rendered = renderReport(config, report)
  if (!opts.quiet || scanChanged(report)) {
    logger.log(rendered)
  } else {
    logger.log(rendered.split(' — ')[0] ?? rendered)
  }
  return 0
}

export function main(argv: readonly string[]): number {
  const parsed = parseArgv(argv)
  if (parsed.command !== 'scan') {
    logger.fail(
      `[team-activity] command '${parsed.command}' is not available yet. ` +
        'Where: CLI. Saw: an unimplemented subcommand; wanted: scan. ' +
        'Fix: use `scan <config.json>` (init/render land in later phases).',
    )
    return 1
  }
  if (!parsed.configPath) {
    logger.fail(
      '[team-activity] no config path. Where: CLI args. Saw: none; wanted: a ' +
        'config JSON path. Fix: node scripts/fleet/team-activity/cli.mts scan <config.json>',
    )
    return 1
  }
  return runScanCommand({ configPath: parsed.configPath, quiet: parsed.quiet })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
