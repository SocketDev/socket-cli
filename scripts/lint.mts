#!/usr/bin/env node
/**
 * @file The scoped lint runner. One entry point drives every linter lane in
 *   `scripts/lib/linters.mts`, in check mode by default and in autofix mode
 *   under `--fix`, so `pnpm run lint` and `pnpm run fix` can never disagree
 *   about which tools have a say.
 *
 *   Scope, highest priority first:
 *
 *     lint <file...>   exactly those files, tracked or brand new
 *     --all            the entire workspace
 *     --staged         the files in the git index
 *     --modified       files modified vs HEAD; the default, aliased --changed
 *
 *   A `--modified` or `--all` run that touches a config, a tsconfig, the
 *   lockfile, or anything under `scripts/` escalates to the whole workspace,
 *   because those files change the verdict for code nobody edited. `--staged`
 *   never escalates, so the pre-commit hook stays fast.
 *
 *   Every lane runs even after one fails, so a single pass surfaces every
 *   failure instead of one per rerun, and the run ends with a one-line-per-lane
 *   summary of what failed.
 *
 *   Usage:
 *     node scripts/lint.mts [--all|--staged|--modified] [--fix] [--quiet] [files...]
 */

import process from 'node:process'

import { isMainModule } from './lib/is-main-module.mts'
import { LINT_LANES, runLane } from './lib/linters.mts'
import { runMain } from './lib/run-main.mts'
import {
  escalatesForScope,
  filterByExtension,
  fixScopeReminder,
  getScopedFiles,
  listWorkspaceFiles,
  resolveExplicitFiles,
  resolveScopeMode,
  zeroScopeNotice,
} from './lib/scope.mts'

import type { ScriptMeta } from './lib/run-main.mts'

/** One lane's verdict, so the summary can name what failed. */
export interface LaneResult {
  readonly name: string
  readonly code: number
  readonly skipped: boolean
}

/**
 * The failure summary for a finished run, or an empty string when every lane
 * passed. One line per failing lane, so a wall of linter output still ends with
 * a readable verdict. Pure — exported for tests.
 */
export function renderLintSummary(results: readonly LaneResult[]): string {
  const failed = results.filter(r => !r.skipped && r.code !== 0)
  if (!failed.length) {
    return ''
  }
  return [
    `[lint] ${failed.length} of ${results.length} lane(s) failed:`,
    ...failed.map(r => `  ${r.name} exited ${r.code}`),
  ].join('\n')
}

function main(): number {
  const argv = process.argv.slice(2)
  const fix = argv.includes('--fix')
  const quiet = argv.includes('--quiet') || argv.includes('--silent')
  const mode = resolveScopeMode(argv)
  const explicitFiles = resolveExplicitFiles(argv)

  const log = (message: string): void => {
    if (!quiet) {
      process.stdout.write(`${message}\n`)
    }
  }

  // Explicit positional paths name exactly what to lint, so they win over every
  // scope flag. Otherwise `--all`, an escalating change, or a git-derived scope
  // decides. A whole-workspace run passes no file list at all, which lets each
  // linter apply its own ignore file.
  let scopeLabel: string
  let files: string[]
  if (explicitFiles.length) {
    scopeLabel = 'explicit'
    files = explicitFiles
  } else if (mode === 'all') {
    scopeLabel = 'all'
    files = []
  } else {
    const scoped = getScopedFiles(mode)
    if (escalatesForScope(mode, scoped)) {
      log('[lint] config or script changed; escalating to the whole workspace.')
      scopeLabel = 'all'
      files = []
    } else {
      scopeLabel = mode
      files = scoped
    }
  }

  const wholeWorkspace = scopeLabel === 'all'

  // A scoped run that resolved to nothing checked nothing. Say so as the
  // verdict — never as a pass — and keep the exit code at 0, because the
  // pre-commit hook legitimately runs this over docs-only commits.
  if (!wholeWorkspace && !files.length) {
    process.stderr.write(`${zeroScopeNotice(scopeLabel, 'lint')}\n`)
    if (fix) {
      log(fixScopeReminder(scopeLabel))
    }
    return 0
  }

  // A whole-workspace run hands each lane an empty list so the tool walks the
  // tree under its own ignore rules — except for a lane that does not read
  // .gitignore, which gets the repo's own file list instead. Without that,
  // gitignored build output and vendored trees land in the gate and a built
  // checkout disagrees with a fresh clone.
  const workspaceFiles = LINT_LANES.some(lane => !lane.honorsVcsIgnore)
    ? listWorkspaceFiles()
    : []

  const results: LaneResult[] = []
  let lintableTotal = 0
  for (const lane of LINT_LANES) {
    let laneFiles: string[]
    if (!wholeWorkspace) {
      laneFiles = filterByExtension(files, lane.extensions)
    } else if (lane.honorsVcsIgnore) {
      laneFiles = []
    } else {
      laneFiles = filterByExtension(workspaceFiles, lane.extensions)
    }
    const walksTree = wholeWorkspace && lane.honorsVcsIgnore
    if (!walksTree && !laneFiles.length) {
      results.push({ code: 0, name: lane.name, skipped: true })
      continue
    }
    lintableTotal += laneFiles.length
    log(
      `[lint] ${lane.name} — scope ${scopeLabel}` +
        (walksTree ? '' : ` (${laneFiles.length} file(s))`),
    )
    results.push({
      code: runLane(lane, { files: laneFiles, fix }),
      name: lane.name,
      skipped: false,
    })
  }

  // Every lane skipped: the scope held files, but none of them were something
  // any linter reads. Same verdict as an empty scope — nothing was checked.
  if (!wholeWorkspace && !lintableTotal) {
    process.stderr.write(`${zeroScopeNotice(scopeLabel, 'lint')}\n`)
    if (fix) {
      log(fixScopeReminder(scopeLabel))
    }
    return 0
  }

  const summary = renderLintSummary(results)
  if (summary) {
    process.stderr.write(`${summary}\n`)
  } else {
    log('[lint] passed')
  }
  if (fix && !wholeWorkspace) {
    log(fixScopeReminder(scopeLabel))
  }
  return summary ? 1 : 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'lints the chosen scope with oxlint, biome, and eslint (files modified vs HEAD by default)',
  help: `Usage: pnpm run lint [flags] [files...]

  [files...]             lint exactly these files; wins over every scope flag
  --modified, --changed  lint files modified vs HEAD (the default)
  --staged               lint the files in the git index (pre-commit path)
  --all                  lint the entire workspace
  --fix                  apply each linter's autofixes
  --quiet, --silent      suppress progress output`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
