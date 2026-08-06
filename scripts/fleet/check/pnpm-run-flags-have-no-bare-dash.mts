#!/usr/bin/env node
/*
 * @file Ban `pnpm run <script> -- --flag`.
 *
 *   pnpm forwards a bare `--` through to the script rather than consuming it,
 *   so the separator that looks like it is delimiting arguments actually
 *   becomes one. What happens next depends on the target's parser, and BOTH
 *   outcomes are bad:
 *
 *     - `parseArgs` (socket-lib / node:util) files everything after `--` under
 *       the `'--'` key rather than parsing it. `--approve` lands in
 *       `values['--']`, `values.approve` stays undefined, and the run proceeds
 *       down its default path. SILENT.
 *     - `runMain` refuses the bare `--` outright and names the script. Loud,
 *       but still a failed run.
 *
 *   This shipped twice, in both flavours. `NPM_APPROVE_COMMAND` and
 *   `CARGO_APPROVE_COMMAND` are the strings printed to an operator as their
 *   next step after a staged release, so each handed out a command that looked
 *   right and either errored or quietly staged again instead of promoting.
 *
 *   The rule is a flat ban rather than "ban it where the parser truncates",
 *   because the separator buys nothing under pnpm in any case: flags reach the
 *   script whether or not it is there. A ban has no false negatives and needs
 *   no per-target parser analysis to stay correct as scripts change.
 *
 *   Exit: 0 clean; 1 at least one occurrence.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// `pnpm run <script>` (or `pnpm <script>`) followed by a bare `--` and then a
// flag. The script name is permissive: names carry `:`, `.` and `-`.
const BARE_DASH_RE = /\bpnpm\s+(?:run\s+)?[\w:.\-/]+\s+--\s+--/

// Test files are skipped. A suite that covers this rule has to SPELL the bad
// form as a fixture, and so does the guard suite for the interactive Bash-tool
// twin (no-vitest-double-dash-guard). Flagging those is noise, and a check that
// reports its own fixtures is one people learn to skim past. The trade is that
// a genuine bad invocation inside a test goes unreported; tests do not hand an
// operator a command to run, so that costs nothing real.
const SKIP_RE = /(?:^|\/)test\//

export type BareDashHit = {
  file: string
  line: number
  text: string
}

/**
 * Every offending line in `text`. Pure, so the suite drives it without a repo.
 */
export function findBareDashRuns(file: string, text: string): BareDashHit[] {
  const out: BareDashHit[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (BARE_DASH_RE.test(line)) {
      out.push({ file, line: i + 1, text: line.trim() })
    }
  }
  return out
}

/**
 * Tracked files worth scanning. Sourced from git so vendored and ignored trees
 * never enter the sweep.
 */
async function trackedFiles(): Promise<string[]> {
  const result = await spawn(
    'git',
    ['ls-files', '-z', '*.mts', '*.ts', '*.md', '*.yml', '*.yaml', '*.json'],
    { cwd: REPO_ROOT, stdioString: true },
  )
  return String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
}

export async function main(): Promise<void> {
  const hits: BareDashHit[] = []
  const files = await trackedFiles()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    if (SKIP_RE.test(rel)) {
      continue
    }
    const abs = path.join(REPO_ROOT, rel)
    if (!existsSync(abs)) {
      continue
    }
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    hits.push(...findBareDashRuns(rel, text))
  }
  if (!hits.length) {
    logger.success(
      '[check-pnpm-run-flags-have-no-bare-dash] no `pnpm run … -- --flag`.',
    )
    return
  }
  logger.fail(
    '[check-pnpm-run-flags-have-no-bare-dash] `pnpm run … -- --flag` found.',
  )
  logger.log('')
  logger.log(
    '  pnpm forwards the bare `--` to the script instead of consuming it.',
  )
  logger.log(
    '  With `parseArgs` the flags land in `values["--"]` and are SILENTLY',
  )
  logger.log('  dropped; with `runMain` the run is refused outright.')
  logger.log('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    logger.log(`    ${hit.file}:${hit.line}: ${hit.text}`)
  }
  logger.log('')
  logger.log('  Fix: drop the `--`, e.g. `pnpm run npm:publish --approve`.')
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no surface spells `pnpm run <script> -- --flag` — the bare dash-dash silently drops the flags',
  help: `Usage: node scripts/fleet/check/pnpm-run-flags-have-no-bare-dash.mts`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
