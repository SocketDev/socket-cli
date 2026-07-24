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
// Two invariants are enforced:
//   - A bump COMMIT (`git commit -m "chore: bump version to X.Y.Z"`) must sit
//     on a green tree — the fast gate (`lint --all` + `pnpm audit`) runs before
//     it, so the bump cannot land atop lint debt that CI then rejects on push.
//     (The slow half — typecheck/tests/coverage — stays in CI.)
//   - A version TAG (`git tag v...`) must sit on a bump commit: HEAD's subject
//     must match `bump version to X.Y.Z` / `chore: release X.Y.Z`, and the same
//     fast gate runs. A tag on a non-bump commit produces a broken release.
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
// Skipped with SOCKET_VERSION_BUMP_SKIP_GATE=1 when the bump ordering is fine
// but the gate is being run out-of-band.

import { which } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { actedOnPath, isFleetTarget } from '../_shared/fleet-context.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  BUMP_SUBJECT_RE,
  bumpCommitMessage,
  committedBumpBasenames,
  isVersionTagCommand,
  missingBumpFiles,
} from './bump-commit-parsing.mts'

// This file lives at <repo-root>/.claude/hooks/fleet/version-bump-order-guard/index.mts —
// anchor on that fixed layout instead of process.cwd(), which is unstable
// depending on where the hook runner invokes from.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = path.join(HERE, '..', '..', '..', '..')

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
      scripts?: Record<string, string> | undefined
    }
    return typeof pkg.scripts?.['lint'] === 'string'
  } catch {
    return false
  }
}

// Newest mtime (ms) under a dir tree, or 0 when absent/empty. Skips
// node_modules + dotdirs so a stray install timestamp can't mask staleness.
export function newestMtime(dir: string): number {
  let newest = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    const abs = path.join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      newest = Math.max(newest, newestMtime(abs))
    } else {
      newest = Math.max(newest, st.mtimeMs)
    }
  }
  return newest
}

// A bump commit must sit on a tree whose coverage was MEASURED after the last
// source change — proof `pnpm run cover` ran on the current code, not a stale
// run from before the final edits. Returns a failure string when the repo opts
// into coverage (a `src/` tree exists) but the coverage summary is missing or
// older than the newest src file. Fail-open (no failure) when there is no `src/`
// (nothing to measure) so non-source repos aren't blocked.
function coverageFreshnessFailure(cwd: string): string | undefined {
  const srcDir = path.join(cwd, 'src')
  if (!existsSync(srcDir)) {
    return undefined
  }
  // The coverage runner writes the merged summary under the fleet coverage
  // cache (node_modules/.cache/fleet/coverage/coverage-summary.json). Hooks run
  // against the target repo's cwd, not this repo's root, so this is a cwd-joined
  // literal rather than the REPO_ROOT-anchored paths.mts constant.
  const summary = path.join(
    cwd,
    'node_modules',
    '.cache',
    'fleet',
    'coverage',
    'coverage-summary.json',
  )
  if (!existsSync(summary)) {
    return (
      // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- socket-lint FP: the string already targets node_modules/.cache/ — it's a human-facing message, and the rule's string matcher can't see the node_modules/ prefix on the same path.
      'no node_modules/.cache/fleet/coverage/coverage-summary.json — run ' +
      '`pnpm run cover` on the current tree before the bump (the json-summary ' +
      'reporter emits it).'
    )
  }
  let summaryMtime = 0
  /* c8 ignore start - statSync throws only in a filesystem race between existsSync and statSync */
  try {
    summaryMtime = statSync(summary).mtimeMs
  } catch {
    return undefined
  }
  /* c8 ignore stop */
  if (newestMtime(srcDir) > summaryMtime) {
    return (
      'node_modules/.cache/fleet/coverage/coverage-summary.json is older than ' +
      'the latest src/ change — re-run `pnpm run cover` so coverage reflects ' +
      'the code being released.'
    )
  }
  return undefined
}

// One gate command through the fleet-preferred ASYNC lib spawn. The lib
// rejects on non-zero exit, so exit semantics come back through catch —
// mapped to a plain code (-1 = spawn-level failure).
async function runGateCommand(
  args: string[],
  config: { cwd?: string | undefined },
): Promise<number> {
  const cfg = { __proto__: null, ...config } as typeof config
  try {
    // Windows shell-shim: pnpm is pnpm.cmd there; the lib resolves .cmd
    // safely under shell (array args stay literal — no injection). Unshelled,
    // the spawn errors and the gate silently vanished on every windows run
    // (the GATE tests' 0-instead-of-2).
    await spawn('pnpm', args, { cwd: cfg.cwd, shell: WIN32 })
    return 0
  } catch (e) {
    const err = e as { code?: number | string | undefined }
    return typeof err.code === 'number' ? err.code : -1
  }
}

// Run the fast pre-release gate (lint --all + pnpm audit). Returns a list
// of human-readable failures; an empty list means the gate passed. Fails
// open on a non-spawnable tool — the gate enforces what it can confirm,
// never invents a failure.
async function runPreReleaseGate(config: {
  cwd?: string | undefined
}): Promise<string[]> {
  const cfg = { __proto__: null, ...config } as typeof config
  const failures: string[] = []
  /* c8 ignore next - cfg.cwd is always provided by the hook payload; the DEFAULT_REPO_ROOT fallback is untestable without chdir */
  const gateCwd = cfg.cwd ?? DEFAULT_REPO_ROOT
  const coverageFailure = coverageFreshnessFailure(gateCwd)
  if (coverageFailure) {
    failures.push(coverageFailure)
  }
  // "pnpm not spawnable → fail open" is decided DETERMINISTICALLY up front: a
  // PATH resolution via the lib's async which. Exit-code archaeology after
  // the fact is platform-fuzzy — under the windows shell shim, cmd launches
  // via ComSpec even with an empty PATH, and command-not-found surfaces as an
  // exit code (9009/127) that varies by shell; the belt below keeps those,
  // but the which-probe is the portable contract.
  if (!(await which('pnpm'))) {
    return failures
  }
  // `pnpm run lint --all` — the exact command CI's Check job runs. A
  // non-zero exit means accumulated lint debt that CI will reject.
  const lintCode = await runGateCommand(['run', 'lint', '--all'], {
    cwd: gateCwd,
  })
  if (lintCode === -1 || lintCode === 9009 || lintCode === 127) {
    return failures
  }
  if (lintCode !== 0) {
    failures.push('`pnpm run lint --all` failed — fix lint before tagging.')
  }
  // `pnpm audit` — open security advisories. Only meaningful against a
  // resolved lockfile; without `pnpm-lock.yaml` it has nothing to audit
  // and its exit code is noise, so skip it there (fail open).
  if (existsSync(path.join(gateCwd, 'pnpm-lock.yaml'))) {
    const auditCode = await runGateCommand(['audit'], { cwd: gateCwd })
    /* c8 ignore start - requires real vulnerable dependencies; not reproducible in a unit test */
    if (auditCode > 0 && auditCode !== 9009 && auditCode !== 127) {
      failures.push(
        '`pnpm audit` found advisories — pin safe versions in ' +
          'pnpm-workspace.yaml overrides (past soak) before tagging.',
      )
    }
    /* c8 ignore stop */
  }
  return failures
}

export const check = bashGuard(async (command, payload) => {
  const bumpMsg = bumpCommitMessage(command)
  const isTag = isVersionTagCommand(command)
  if (!bumpMsg && !isTag) {
    return undefined
  }

  // The directory the command ACTS on, honoring a `cd <repo> && git …` — a
  // wheelhouse-rooted session bumping a sibling repo must be gated against
  // THAT repo's tree/HEAD, not the session cwd's.
  const effectiveCwd = actedOnPath(payload)
  const opts = { cwd: effectiveCwd }

  // The prep-wave gate (lint --all / audit / coverage freshness) encodes the
  // FLEET release convention; a non-fleet repo keeps only the generic ordering
  // invariants (bump files bundled, tag sits on a bump commit).
  const fleetTarget = isFleetTarget(payload)

  // Bump-commit bundling: the bump commit must carry BOTH package.json and
  // CHANGELOG.md. Splitting them ships a release whose CHANGELOG lags the
  // version (or a version with no public note). Runs for every bump commit,
  // independent of the lint gate below.
  if (bumpMsg) {
    const missing = missingBumpFiles(
      committedBumpBasenames(command, effectiveCwd),
    )
    if (missing.length) {
      const lines = [
        '[version-bump-order-guard] Bump commit must stage package.json AND CHANGELOG.md.',
        '',
        `  Bump commit : ${bumpMsg}`,
        `  Missing     : ${missing.join(', ')}`,
        '',
        '  The version delta and its public CHANGELOG note land in ONE commit.',
        '  Stage both, then commit (named paths keep a parallel session out):',
        '',
        '    git commit -o package.json CHANGELOG.md -m "chore: bump version to X.Y.Z"',
        '',
      ]
      return block(lines.join('\n') + '\n')
    }
  }

  // Pre-bump-COMMIT gate: the bump commit is where a still-broken tree
  // (accumulated lint debt) silently lands — front-run the same fast gate the
  // tag step runs, so the bump can't be committed onto a tree CI will reject.
  // (Past incident: a `chore: bump version` committed atop 100+ lint errors
  // sailed in, then failed CI on push.)
  if (
    bumpMsg &&
    fleetTarget &&
    !process.env['SOCKET_VERSION_BUMP_SKIP_GATE'] &&
    hasLintScript(effectiveCwd)
  ) {
    const gateFailures = await runPreReleaseGate(opts)
    if (gateFailures.length) {
      const lines = [
        '[version-bump-order-guard] Pre-bump gate failed — refusing the bump commit.',
        '',
        `  Bump commit : ${bumpMsg}`,
        '',
        ...gateFailures.map(f => `  ✗ ${f}`),
        '',
        '  The bump commit must sit on a GREEN tree. Run the prep wave clean',
        '  BEFORE committing the bump:',
        '',
        '    pnpm run update',
        '    pnpm i',
        '    pnpm run fix --all',
        '    pnpm run check --all   # typecheck + unit tests + coverage',
        '',
        '  Then commit `chore: bump version to X.Y.Z`.',
        '',
        '  Bypass the gate only: SOCKET_VERSION_BUMP_SKIP_GATE=1',
        '',
      ]
      return block(lines.join('\n') + '\n')
    }
    // A bump commit isn't a tag — once gated (pass or block), we're done.
    return undefined
  }
  if (!isTag) {
    return undefined
  }

  // Fast pre-release gate: a tag whose tree fails lint or carries an open
  // advisory would publish a broken / vulnerable release. Run it before
  // the ordering check so a clean-ordering-but-dirty-tree tag still blocks.
  if (
    fleetTarget &&
    !process.env['SOCKET_VERSION_BUMP_SKIP_GATE'] &&
    hasLintScript(effectiveCwd)
  ) {
    const gateFailures = await runPreReleaseGate(opts)
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
        '',
      ]
      return block(gateLines.join('\n') + '\n')
    }
  }

  // Read the most-recent commit subject from HEAD.
  const subjectResult = spawnSync('git', ['log', '-1', '--pretty=%s'], opts)
  if (subjectResult.status !== 0) {
    // Not a git repo or git unavailable — fail open. Under SOCKET_DEBUG, say
    // so with the inputs: a windows CI run allowed a tag the fixture proved
    // should block, with zero output — a mangled acted-on path failing this
    // spawn is the prime suspect, and only the inputs can confirm it.
    if (process.env['SOCKET_DEBUG']) {
      process.stderr.write(
        `[version-bump-order-guard] fail-open: subject read failed (status ${subjectResult.status}, cwd ${effectiveCwd}, stderr ${String(subjectResult.stderr ?? '').trim()})\n`,
      )
    }
    return undefined
  }
  const headSubject = String(subjectResult.stdout).trim()
  if (BUMP_SUBJECT_RE.test(headSubject)) {
    if (process.env['SOCKET_DEBUG']) {
      process.stderr.write(
        `[version-bump-order-guard] allow: HEAD subject is a bump (${headSubject}, cwd ${effectiveCwd})\n`,
      )
    }
    return undefined
  }

  // Look up whether CHANGELOG.md was touched in HEAD.
  let changelogTouched = false
  const filesResult = spawnSync(
    'git',
    ['show', '--name-only', '--pretty=', 'HEAD'],
    opts,
  )
  /* c8 ignore next - git show fails after git log succeeds only in a filesystem race or corrupted repo; not reproducible in a unit test */
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
  ]
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  bypass: ['version-bump-order'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
