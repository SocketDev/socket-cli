#!/usr/bin/env node
/*
 * @file Assert this repo's `.gitignore` ignores a `node_modules` SYMLINK, not
 *   just the directory. `node_modules/` with a trailing slash matches a
 *   DIRECTORY only; a symlink is a FILE to git, so that spelling misses the
 *   link entirely and a broad `git add` stages it. That is exactly how a
 *   cascade worktree's `node_modules → /Users/<user>/projects/<repo>/
 *   node_modules` link was committed and pushed: in CI the target is absent, so
 *   `mkdirSync(p, { recursive: true })` on the dangling link throws `ENOENT` and
 *   the pre-install bootstrap dies. The edit-time layer is the
 *   `no-self-referential-symlink-guard` hook; this is the defence-in-depth
 *   underneath it — a repo whose ignore rule actually covers the link never
 *   gets the chance to stage one.
 *
 *   The assertion is about the OUTCOME, never a blessed literal string.
 *   Several spellings are correct (`**\/node_modules`, a bare `node_modules`,
 *   …) and several are not (`node_modules/`, `/node_modules` for a nested
 *   link), so grepping for one pattern would produce false failures. Instead
 *   the check seeds a THROWAWAY repo with these exact `.gitignore` bytes,
 *   creates a real symlink named `node_modules` at the root and one package
 *   deep, and asks `git check-ignore`. A redundant extra `node_modules/` line
 *   alongside a correct pattern is harmless and is not flagged — git's
 *   last-match-wins ordering is git's to decide, and git is the one answering.
 *
 *   Report-only for now (`MODE`). Six fleet members carry the trailing-slash
 *   spelling today, so promoting this to a hard gate on day one would turn
 *   every one of their `check --all` runs red at once. Flip `MODE` to
 *   `'strict'` once the fleet is clean. Detail:
 *   docs/agents.md/fleet/single-gitignore.md.
 *
 *   Exit codes: 0 — clean, or a gap under report mode; 1 — a gap under strict.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runGit } from '../../../.claude/hooks/fleet/_shared/git-runner.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// DISABLED SEAM: report-only until the six trailing-slash members are fixed;
// flip to 'strict' (exit 1) after. A new gate has never been green, so
// promoting it before the backlog clears blocks every member at once.
const MODE: 'report' | 'strict' = 'report'

// The `.gitignore` files a repo can own, relative to its root. The
// `template/base` seed exists only in the wheelhouse — it is what a fresh
// member starts from, so a gap there ships the defect to the next onboarding.
export const GITIGNORE_PATHS: readonly string[] = [
  '.gitignore',
  'template/base/.gitignore',
]

// The link is created dangling on purpose: the incident's link dangled too, and
// a probe that needs a real target would depend on state outside its own
// throwaway tree.
const PROBE_LINK_TARGET = '/nonexistent-node-modules-probe-target'

// Where the probe plants its links. Root and one package deep, because the two
// answers differ: `/node_modules` covers the root and misses the nested one.
const PROBE_ROOT_LINK = 'node_modules'
const PROBE_NESTED_LINK = 'packages/a/node_modules'

export interface SymlinkIgnoreVerdict {
  // `undefined` when git could not answer — no opinion, never a finding.
  readonly nestedIgnored: boolean | undefined
  readonly rootIgnored: boolean | undefined
}

export interface GitignoreGap {
  // Repo-relative path of the `.gitignore` that misses the link.
  readonly file: string
  // The probe paths it failed to ignore.
  readonly scopes: readonly string[]
}

// `git check-ignore -q` exits 0 when the path IS ignored and 1 when it is not.
// Anything else (128, or a null status from a killed child) means git did not
// answer the question, which is not the same as "not ignored".
function checkIgnored(cwd: string, rel: string): boolean | undefined {
  const { status } = runGit(['check-ignore', '-q', '--', rel], { cwd })
  if (status === 0) {
    return true
  }
  return status === 1 ? false : undefined
}

/**
 * Ask git — not a pattern model — whether these `.gitignore` bytes ignore a
 * symlink named `node_modules`, at the root and one package deep. Seeds a
 * throwaway repo so the answer is git's own, including every ordering and
 * negation rule a hand-rolled matcher would have to re-derive.
 */
export function probeNodeModulesSymlinkIgnored(
  gitignoreText: string,
): SymlinkIgnoreVerdict {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-symlink-probe-'))
  try {
    // `--template=` keeps the user's init templates (sample hooks, an exclude
    // file) out of the probe, so only the bytes under test decide the answer.
    if (runGit(['init', '-q', '--template=', dir]).status !== 0) {
      return { nestedIgnored: undefined, rootIgnored: undefined }
    }
    writeFileSync(path.join(dir, '.gitignore'), gitignoreText)
    mkdirSync(path.join(dir, path.dirname(PROBE_NESTED_LINK)), {
      recursive: true,
    })
    symlinkSync(PROBE_LINK_TARGET, path.join(dir, PROBE_ROOT_LINK))
    symlinkSync(PROBE_LINK_TARGET, path.join(dir, PROBE_NESTED_LINK))
    return {
      nestedIgnored: checkIgnored(dir, PROBE_NESTED_LINK),
      rootIgnored: checkIgnored(dir, PROBE_ROOT_LINK),
    }
  } finally {
    safeDeleteSync(dir)
  }
}

/**
 * Every `.gitignore` under `repoRoot` that would let a `node_modules` symlink
 * through. An absent file is not a gap — a repo may legitimately have no
 * `template/base/` seed.
 */
export function findNodeModulesSymlinkGaps(repoRoot: string): GitignoreGap[] {
  const gaps: GitignoreGap[] = []
  for (let i = 0, { length } = GITIGNORE_PATHS; i < length; i += 1) {
    const rel = GITIGNORE_PATHS[i]!
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    const verdict = probeNodeModulesSymlinkIgnored(readFileSync(abs, 'utf8'))
    const scopes: string[] = []
    if (verdict.rootIgnored === false) {
      scopes.push(PROBE_ROOT_LINK)
    }
    if (verdict.nestedIgnored === false) {
      scopes.push(PROBE_NESTED_LINK)
    }
    if (scopes.length) {
      gaps.push({ file: rel, scopes })
    }
  }
  return gaps
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const gaps = findNodeModulesSymlinkGaps(REPO_ROOT)
  if (!gaps.length) {
    if (!quiet) {
      logger.success(
        '[node-modules-symlink-is-ignored] a node_modules SYMLINK is ignored at ' +
          'the root and nested.',
      )
    }
    return
  }
  const strict = MODE === 'strict'
  const report = strict ? logger.fail : logger.warn
  report.call(
    logger,
    `[node-modules-symlink-is-ignored] ${gaps.length} .gitignore file(s) match ` +
      `only a node_modules DIRECTORY, so a node_modules SYMLINK is stageable` +
      (strict ? ':' : ' (report-only):'),
  )
  logger.group()
  for (let i = 0, { length } = gaps; i < length; i += 1) {
    const gap = gaps[i]!
    report.call(logger, `${gap.file} — not ignored: ${gap.scopes.join(', ')}`)
  }
  logger.groupEnd()
  logger.log(
    'Fix: replace the `node_modules/` line with `**/node_modules` (no trailing ' +
      'slash — a trailing slash matches a directory, and a symlink is a file to ' +
      'git). Keeping the old line alongside it is harmless.',
  )
  if (strict) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "checks the repo's .gitignore ignores a node_modules SYMLINK, not just the directory",
  help: `Usage: node scripts/fleet/check/node-modules-symlink-is-ignored.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
