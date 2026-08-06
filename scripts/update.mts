#!/usr/bin/env node
/**
 * @file The dependency update entry point. Three passes, in order, so nothing
 *   races and every run is reproducible:
 *
 *     1. Third party — taze, governed by taze.config.mts, which holds the
 *        7-day maturity window and the exclude list. A package published in
 *        the last week is not picked up.
 *     2. Socket-owned scopes — @socketsecurity/* and @socketregistry/*, taken
 *        straight to latest. These are ours, so they skip the soak window.
 *     3. Lockfile — `pnpm install`, so pnpm-lock.yaml matches the package.json
 *        the first two passes wrote.
 *
 *   The order matters and the passes must not overlap: passes 1 and 2 both
 *   rewrite package.json, so running them concurrently is a lost-update race on
 *   the same file.
 *
 *   `--dry-run` previews both dependency passes without writing anything: taze
 *   runs in report-only mode for third-party packages and again, with the soak
 *   window off, for the Socket scopes. No install runs. The run then re-reads
 *   package.json and fails loudly if a single byte moved, so "dry run" is a
 *   checked promise rather than an intention.
 *
 *   A live run finishes by printing every version that actually moved, read
 *   from package.json before and after, so the outcome comes from the file
 *   rather than from a tool's summary line.
 *
 *   Usage:
 *     node scripts/update.mts [--dry-run]
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isMainModule } from './lib/is-main-module.mts'
import { REPO_ROOT } from './lib/linters.mts'
import { runMain } from './lib/run-main.mts'

import type { ScriptMeta } from './lib/run-main.mts'

const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json')

const WIN32 = process.platform === 'win32'

/**
 * The Socket-owned scopes that skip the maturity window. We publish these, so
 * the soak period a third-party package earns does not apply.
 */
export const SOCKET_SCOPES: readonly string[] = [
  '@socketregistry/*',
  '@socketsecurity/*',
]

/** The package.json sections a version can move in. */
const DEPENDENCY_SECTIONS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

/** One dependency whose declared version changed. */
export interface VersionMove {
  readonly name: string
  readonly section: string
  readonly from: string
  readonly to: string
}

/** True when argv asks for a preview instead of a live run. Pure. */
export function isDryRun(argv: readonly string[]): boolean {
  return argv.includes('--dry-run')
}

/**
 * The argv for a taze pass. `write` false is spelled `--no-write` so a preview
 * cannot be undone by taze.config.mts, which sets `write: true` for the live
 * run. `include` narrows the pass to a set of name globs, and `maturityPeriod`
 * overrides the config's soak window for the Socket scopes. Pure — exported for
 * tests.
 */
export function buildTazeArgs(options: {
  write: boolean
  include?: readonly string[] | undefined
  maturityPeriod?: number | undefined
}): string[] {
  const args: string[] = [options.write ? '--write' : '--no-write']
  if (options.include?.length) {
    args.push('--include', options.include.join(','))
  }
  if (options.maturityPeriod !== undefined) {
    args.push('--maturity-period', String(options.maturityPeriod))
  }
  return args
}

/** One declared dependency: which section it sits in and what it asks for. */
export interface DependencyPin {
  readonly name: string
  readonly section: string
  readonly spec: string
}

/**
 * Every declared dependency in a package.json body. The same package can appear
 * in two sections with different specs, so a pin carries its section rather
 * than being keyed by name alone. Pure — exported for tests.
 */
export function readDependencyPins(raw: string): DependencyPin[] {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const pins: DependencyPin[] = []
  for (const section of DEPENDENCY_SECTIONS) {
    const block = parsed[section]
    if (!block || typeof block !== 'object') {
      continue
    }
    for (const [name, spec] of Object.entries(
      block as Record<string, unknown>,
    )) {
      if (typeof spec === 'string') {
        pins.push({ name, section, spec })
      }
    }
  }
  return pins
}

/** Section to name to spec, so a lookup never has to parse a composite key. */
function indexPins(
  pins: readonly DependencyPin[],
): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>()
  for (const pin of pins) {
    let bySection = index.get(pin.section)
    if (!bySection) {
      bySection = new Map<string, string>()
      index.set(pin.section, bySection)
    }
    bySection.set(pin.name, pin.spec)
  }
  return index
}

/**
 * Every dependency whose declared version differs between two package.json
 * bodies, sorted by name. Additions and removals are not moves and are left
 * out. Pure — exported for tests.
 */
export function diffDependencyVersions(
  beforeRaw: string,
  afterRaw: string,
): VersionMove[] {
  const after = indexPins(readDependencyPins(afterRaw))
  const moves: VersionMove[] = []
  for (const pin of readDependencyPins(beforeRaw)) {
    const to = after.get(pin.section)?.get(pin.name)
    if (to === undefined || to === pin.spec) {
      continue
    }
    moves.push({ from: pin.spec, name: pin.name, section: pin.section, to })
  }
  return moves.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The human report for a set of moves — one line each, or a single line saying
 * nothing moved. Pure — exported for tests.
 */
export function renderVersionMoves(moves: readonly VersionMove[]): string {
  if (!moves.length) {
    return '[update] no dependency versions moved.'
  }
  const width = Math.max(...moves.map(m => m.name.length))
  return [
    `[update] ${moves.length} dependency version(s) moved:`,
    ...moves.map(
      m => `  ${m.name.padEnd(width)}  ${m.from} -> ${m.to}  (${m.section})`,
    ),
  ].join('\n')
}

/**
 * The message for a preview that wrote to package.json anyway. A dry run that
 * mutates is worse than no dry run, because the caller trusts it. Pure —
 * exported for tests.
 */
export function dryRunMutationMessage(moves: readonly VersionMove[]): string {
  return (
    'a --dry-run update changed package.json\n' +
    '  Where: scripts/update.mts, comparing package.json before and after the preview passes.\n' +
    `  Saw: ${moves.length} version(s) rewritten; wanted a byte-identical file.\n` +
    '  Fix: restore package.json with `git checkout -- package.json`, then report this — a preview pass is spawning taze in write mode.'
  )
}

/**
 * Run a command, inheriting stdio, and return its exit code. A spawn that never
 * started is reported as 1, never as a silent success.
 */
function run(command: string, args: readonly string[]): number {
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    shell: WIN32,
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(
      `${command} did not start\n` +
        `  Where: scripts/update.mts, spawning \`${command}\`.\n` +
        `  Saw: ${result.error.message}; wanted the command on PATH.\n` +
        '  Fix: run `pnpm install`, then retry.\n',
    )
    return 1
  }
  return result.status ?? 1
}

/** taze from the repo's own node_modules, never a global copy. */
function runTaze(args: readonly string[]): number {
  return run(
    path.join(REPO_ROOT, 'node_modules', '.bin', WIN32 ? 'taze.cmd' : 'taze'),
    args,
  )
}

function main(): number {
  const argv = process.argv.slice(2)
  const dryRun = isDryRun(argv)
  const beforeRaw = readFileSync(PACKAGE_JSON_PATH, 'utf8')

  process.stdout.write(
    `[update] ${dryRun ? 'previewing' : 'applying'} dependency updates.\n`,
  )

  // Pass 1 — third party, soak-gated by taze.config.mts.
  process.stdout.write(
    '[update] pass 1/3: third-party packages (7-day soak).\n',
  )
  let code = runTaze(buildTazeArgs({ write: !dryRun }))
  if (code !== 0) {
    process.stderr.write(`[update] pass 1 failed (taze exited ${code}).\n`)
    return code
  }

  // Pass 2 — Socket-owned scopes, no soak. A live run goes through pnpm so the
  // scopes resolve against the registry the workspace is configured for; a
  // preview goes through taze, which is the only one of the two that can report
  // without writing.
  process.stdout.write('[update] pass 2/3: Socket scopes (no soak).\n')
  code = dryRun
    ? runTaze(
        buildTazeArgs({
          include: SOCKET_SCOPES,
          maturityPeriod: 0,
          write: false,
        }),
      )
    : run('pnpm', ['update', ...SOCKET_SCOPES, '--latest'])
  if (code !== 0) {
    process.stderr.write(`[update] pass 2 failed (exited ${code}).\n`)
    return code
  }

  // Pass 3 — lockfile, live runs only.
  if (dryRun) {
    process.stdout.write(
      '[update] pass 3/3: skipped, dry run writes nothing.\n',
    )
  } else {
    process.stdout.write('[update] pass 3/3: refreshing pnpm-lock.yaml.\n')
    code = run('pnpm', ['install'])
    if (code !== 0) {
      process.stderr.write(
        `[update] pass 3 failed (pnpm install exited ${code}).\n`,
      )
      return code
    }
  }

  const afterRaw = readFileSync(PACKAGE_JSON_PATH, 'utf8')
  const moves = diffDependencyVersions(beforeRaw, afterRaw)

  if (dryRun && beforeRaw !== afterRaw) {
    process.stderr.write(`${dryRunMutationMessage(moves)}\n`)
    return 1
  }

  process.stdout.write(
    `${dryRun ? '[update] dry run complete, nothing written.' : renderVersionMoves(moves)}\n`,
  )
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'updates dependencies in three ordered passes — soak-gated third party, Socket scopes, then the lockfile',
  help: `Usage: pnpm run update [--dry-run]

  --dry-run   report what would move without writing package.json or the
              lockfile, then verify that nothing was written

  Pass 1 runs taze under taze.config.mts (7-day maturity window, exclude list).
  Pass 2 takes @socketsecurity/* and @socketregistry/* to latest with no soak.
  Pass 3 runs pnpm install so pnpm-lock.yaml matches the new package.json.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
