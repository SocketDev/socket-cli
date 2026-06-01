#!/usr/bin/env node
// Claude Code PreToolUse hook — version-bump-order-guard.
//
// Blocks `git tag vX.Y.Z` invocations when the prep wave or the bump
// commit hasn't landed yet. The fleet's "Version bumps" rule says:
//
//   1. `pnpm run update` → `pnpm i` → `pnpm run fix --all` → `pnpm run
//      check --all` (each clean before the next).
//   2. CHANGELOG.md entry — public-facing only.
//   3. The `chore: bump version to X.Y.Z` commit is the LAST commit on
//      the release branch.
//   4. THEN `git tag vX.Y.Z` at the bump commit.
//   5. Do NOT dispatch the publish workflow.
//
// This hook is a guard around step 4: when the user runs `git tag
// v...`, the most-recent commit on HEAD must look like a bump commit
// (its subject matches `bump version to X.Y.Z` or `chore: release
// X.Y.Z`). Without that, the tag is being placed on a non-bump commit,
// which produces a broken release.
//
// It ALSO runs the fast half of the pre-release gate at tag time — the
// two checks cheap enough for a synchronous hook: `pnpm run lint --all`
// (the same lint CI's Check job runs) and `pnpm audit` (open security
// advisories). A tag whose tree fails either would publish a release CI
// rejects, or one carrying a known-vulnerable dependency. The slow half
// of the gate — `pnpm run check --all` typecheck, unit tests, coverage —
// stays in CI; this hook front-runs the two that catch the common
// release-day breakage (accumulated lint debt, an unpinned advisory).
//
// Bypass: "Allow version-bump-order bypass" in a recent user turn, or
// SOCKET_VERSION_BUMP_ORDER_GUARD_DISABLED=1. The gate half alone can be
// skipped with SOCKET_VERSION_BUMP_SKIP_GATE=1 when the bump ordering is
// fine but the gate is being run out-of-band.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASES = [
  'Allow version-bump-order bypass',
  'Allow version bump order bypass',
  'Allow versionbumporder bypass',
] as const

// `git tag <name>` (also `git tag -a`, `git tag -s`, etc.) creating a
// version tag (`vX.Y.Z`). Parser-based: a real `git` command with a
// `tag` arg and a version-shaped arg — so a quoted "git tag v1.2.3" in
// a message or a sibling command's string isn't a false trigger.
const VERSION_ARG_RE = /^v\d+\.\d+\.\d+$/
function isVersionTagCommand(command: string): boolean {
  return commandsFor(command, 'git').some(
    c => c.args.includes('tag') && c.args.some(a => VERSION_ARG_RE.test(a)),
  )
}

// Subject patterns that count as a "bump commit". Matches Keep-a-
// Changelog style and Conventional Commits style.
const BUMP_SUBJECT_RE =
  /^(?:chore(?:\([\w-]+\))?:\s+(?:bump version to|release)\s+v?\d+\.\d+\.\d+|chore(?:\([\w-]+\))?:\s+v?\d+\.\d+\.\d+\s+release)/i

// Whether the repo at `cwd` declares a `lint` script. The gate only runs
// where there's something to gate — a repo with no `lint` script (or no
// package.json at all) fails open, so this guard stays a pure tag-ordering
// check there.
function hasLintScript(cwd: string): boolean {
  try {
    const pkgPath = path.join(cwd, 'package.json')
    if (!existsSync(pkgPath)) {
      return false
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    return typeof pkg.scripts?.['lint'] === 'string'
  } catch {
    return false
  }
}

// Run the fast pre-release gate (lint --all + pnpm audit). Returns a list
// of human-readable failures; an empty list means the gate passed. Fails
// open on a non-spawnable tool — the gate enforces what it can confirm,
// never invents a failure.
function runPreReleaseGate(opts: { cwd?: string }): string[] {
  const failures: string[] = []
  const spawnOpts = { ...opts, stdio: 'pipe' as const }
  // `pnpm run lint --all` — the exact command CI's Check job runs. A
  // non-zero exit means accumulated lint debt that CI will reject.
  const lint = spawnSync('pnpm', ['run', 'lint', '--all'], spawnOpts)
  if (lint.error) {
    // pnpm not spawnable — can't confirm, fail open.
    return failures
  }
  if (lint.status !== 0) {
    failures.push('`pnpm run lint --all` failed — fix lint before tagging.')
  }
  // `pnpm audit` — open security advisories. Only meaningful against a
  // resolved lockfile; without `pnpm-lock.yaml` it has nothing to audit
  // and its exit code is noise, so skip it there (fail open).
  const cwd = opts.cwd ?? process.cwd()
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    const audit = spawnSync('pnpm', ['audit'], spawnOpts)
    if (!audit.error && audit.status !== 0) {
      failures.push(
        '`pnpm audit` found advisories — pin safe versions in ' +
          'pnpm-workspace.yaml overrides (past soak) before tagging.',
      )
    }
  }
  return failures
}

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {
  if (process.env['SOCKET_VERSION_BUMP_ORDER_GUARD_DISABLED']) {
    return
  }
  if (!isVersionTagCommand(command)) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return
  }

  const opts = payload.cwd ? { cwd: payload.cwd } : {}

  // Fast pre-release gate: a tag whose tree fails lint or carries an open
  // advisory would publish a broken / vulnerable release. Run it before
  // the ordering check so a clean-ordering-but-dirty-tree tag still blocks.
  if (
    !process.env['SOCKET_VERSION_BUMP_SKIP_GATE'] &&
    hasLintScript(opts.cwd ?? process.cwd())
  ) {
    const gateFailures = runPreReleaseGate(opts)
    if (gateFailures.length) {
      const gateLines = [
        '[version-bump-order-guard] Pre-release gate failed for tag.',
        '',
        ...gateFailures.map(f => `  ✗ ${f}`),
        '',
        '  Run the full prep wave clean before tagging:',
        '',
        '    pnpm run update',
        '    pnpm i',
        '    pnpm run fix --all',
        '    pnpm run check --all   # typecheck + unit tests + coverage',
        '',
        '  Bypass the gate only: SOCKET_VERSION_BUMP_SKIP_GATE=1',
        '  Bypass the whole guard: "Allow version-bump-order bypass".',
        '',
      ]
      logger.error(gateLines.join('\n') + '\n')
      process.exitCode = 2
      return
    }
  }

  // Read the most-recent commit subject from HEAD.
  const subjectResult = spawnSync('git', ['log', '-1', '--pretty=%s'], opts)
  if (subjectResult.status !== 0) {
    // Not a git repo or git unavailable — fail open.
    return
  }
  const headSubject = String(subjectResult.stdout).trim()
  if (BUMP_SUBJECT_RE.test(headSubject)) {
    return
  }

  // Look up whether CHANGELOG.md was touched in HEAD.
  let changelogTouched = false
  const filesResult = spawnSync(
    'git',
    ['show', '--name-only', '--pretty=', 'HEAD'],
    opts,
  )
  if (filesResult.status === 0) {
    changelogTouched = /\bCHANGELOG\.md\b/i.test(String(filesResult.stdout))
  }

  const lines = [
    '[version-bump-order-guard] Tagging vX.Y.Z but HEAD is not a bump commit.',
    '',
    `  HEAD subject : ${headSubject}`,
    `  CHANGELOG.md : ${changelogTouched ? 'touched' : 'NOT touched'} in HEAD`,
    '',
    '  Per CLAUDE.md "Version bumps", the bump commit must be the LAST',
    '  commit on the release. Expected subject shape:',
    '',
    '    chore: bump version to X.Y.Z',
    '    chore(scope): release X.Y.Z',
    '',
    '  If a bump commit exists earlier in history, rebase it forward to',
    "  the tip. If it doesn't exist yet, run the prep wave first:",
    '',
    '    pnpm run update',
    '    pnpm i',
    '    pnpm run fix --all',
    '    pnpm run check --all',
    '',
    '  Then update CHANGELOG.md and commit `chore: bump version to X.Y.Z`',
    '  carrying package.json + CHANGELOG.md. Then tag.',
    '',
    '  Bypass: type "Allow version-bump-order bypass" in a recent message.',
    '',
  ]
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
})
