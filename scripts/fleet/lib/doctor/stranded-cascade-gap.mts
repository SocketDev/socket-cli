/**
 * @file Gap #3 engine (drift-cascade / git) — stranded cascade artifacts. Pure
 *   functions, no FS reads, no network. The doctor.mts caller runs `node
 *   scripts/repo/cleanup-stranded.mts --target . --dry-run` and passes the
 *   stdout/stderr here. The existing cleanup-stranded.mts already detects
 *   unpushed `chore(wheelhouse): cascade template@<sha>` commits and superseded
 *   `chore/wheelhouse-<sha>` worktrees in --dry-run mode; this module wraps
 *   that output into a DoctorFinding rather than reimplementing the detection.
 *   The finding is report-only (fixable: false) — the fix is an explicit
 *   operator invocation of cleanup-stranded (bare = apply mode).
 */

import type { DoctorFinding } from './catalog-gap.mts'

export interface StrandedCascadeReport {
  bailReason: string | undefined
  strandedCommits: string[]
  strandedWorktrees: string[]
}

/**
 * Parse the stdout of `cleanup-stranded.mts --target <repo> --dry-run` into a
 * structured report. The script emits lines of the form:
 *
 * [<repo>] stranded local commits (<n>):
 * <sha12>  <subject>
 * [<repo>] stranded worktrees (<n>):
 * <branch>  <path>
 * [<repo>] --dry-run: nothing applied.
 * [<repo>] not cleaning up: <reason>
 * no stranded cascade artifacts found.
 */
// Strip ANSI escape sequences, then strip the leading logger glyph + markup
// prefix that getDefaultLogger() emits (`ℹ ` for info, `⚠ ` for warn). The
// real cleanup-stranded output passes through the lib logger before reaching
// this parser; stripping here keeps `saw` entries clean and makes the regexes
// robust across logger format changes.
export function stripLoggerPrefix(line: string): string {
  // Remove ANSI CSI sequences (e.g. \x1b[94m … \x1b[39m).
  // oxlint-disable-next-line prefer-regex-literals -- constructed for clarity
  const noAnsi = line.replace(/\x1b\[[0-9;]*m/g, '')
  // Strip the leading glyph character (ℹ, ⚠, ✖, etc.) and any following
  // whitespace that the logger inserts before the message body.
  return noAnsi.replace(/^[\p{So}\p{Sm}\p{Sk}✓✗✖⚠ℹ]\s*/u, '')
}

export function parseStrandedOutput(output: string): StrandedCascadeReport {
  const lines = output.split('\n')
  const strandedCommits: string[] = []
  const strandedWorktrees: string[] = []
  let bailReason: string | undefined
  let mode: 'commits' | 'worktrees' | undefined

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const stripped = stripLoggerPrefix(line).trim()
    if (!stripped) {
      continue
    }

    // Bail line: `[<repo>] not cleaning up: <reason>`
    const bailMatch = /\[.+?\] not cleaning up: (.+)$/.exec(stripped)
    if (bailMatch?.[1]) {
      bailReason = bailMatch[1]
      mode = undefined
      continue
    }

    // Section headers.
    if (/\[.+?\] stranded local commits \(\d+\):/.test(stripped)) {
      mode = 'commits'
      continue
    }
    if (/\[.+?\] stranded worktrees \(\d+\):/.test(stripped)) {
      mode = 'worktrees'
      continue
    }

    // Dry-run summary and "none found" lines — end collection.
    if (
      stripped.includes('--dry-run: nothing applied') ||
      stripped.includes('no stranded cascade artifacts found')
    ) {
      mode = undefined
      continue
    }

    // Collect entries under the active section, clean of glyph noise.
    if (mode === 'commits' && stripped.length > 0) {
      strandedCommits.push(stripped)
    } else if (mode === 'worktrees' && stripped.length > 0) {
      strandedWorktrees.push(stripped)
    }
  }

  return { bailReason, strandedCommits, strandedWorktrees }
}

// A `chore(wheelhouse): cascade template@<sha>` subject, the only commit shape
// cleanup-stranded will ever discard.
const CASCADE_SUBJECT_RE = /chore\(wheelhouse\): cascade template@[0-9a-f]+/

/**
 * Why a set of local-ahead commits is NOT safe to treat as stranded, or
 * undefined when it is.
 *
 * This is the rail cleanup-stranded's planner already enforces: it refuses to
 * act the moment a non-cascade commit sits among the local-ahead set, because
 * its remedy is `git reset --hard origin/<base>` and that would take the real
 * work with it. A local cascade commit carrying other commits on top is
 * UNPUSHED, not stranded, and the cure is a push.
 *
 * The doctor has to make the same call. Its member-repo path cannot shell to
 * cleanup-stranded, which is wheelhouse-only, so it greps git log instead — and
 * without this rail that grep reported a destructive fix for a repo the real
 * script declines to touch. Two fleet surfaces disagreeing is bad; the one
 * recommending `reset --hard` being the wrong one is worse.
 */
export function strandedBailReason(
  localAheadSubjects: readonly string[],
): string | undefined {
  for (let i = 0, { length } = localAheadSubjects; i < length; i += 1) {
    const entry = localAheadSubjects[i]!.trim()
    if (!entry || CASCADE_SUBJECT_RE.test(entry)) {
      continue
    }
    const sha = /^([0-9a-f]{7,40})\b/.exec(entry)?.[1]
    return `non-cascade commit ${sha ? sha.slice(0, 12) : entry.slice(0, 40)} present locally — not safe to auto-clean`
  }
  return undefined
}

/**
 * Detect stranded cascade artifacts from cleanup-stranded --dry-run output.
 * Returns a DoctorFinding when stranded commits or worktrees are present,
 * undefined when the repo is clean.
 *
 * @param output - Combined stdout+stderr of:
 *   `node scripts/repo/cleanup-stranded.mts --target . --dry-run`
 */
export function detectStrandedCascade(
  output: string,
): DoctorFinding | undefined {
  const report = parseStrandedOutput(output)
  if (
    report.bailReason ||
    (report.strandedCommits.length === 0 &&
      report.strandedWorktrees.length === 0)
  ) {
    return undefined
  }
  return formatStrandedCascadeFinding(report)
}

/**
 * Format a finding for stranded cascade artifacts (commits + worktrees).
 */
export function formatStrandedCascadeFinding(
  report: StrandedCascadeReport,
): DoctorFinding {
  const commitLines =
    report.strandedCommits.length > 0
      ? `\nStranded commits:\n${report.strandedCommits.map(c => `  ${c}`).join('\n')}`
      : ''
  const worktreeLines =
    report.strandedWorktrees.length > 0
      ? `\nStranded worktrees:\n${report.strandedWorktrees.map(w => `  ${w}`).join('\n')}`
      : ''
  const total = report.strandedCommits.length + report.strandedWorktrees.length

  return {
    fix: [
      `Run cleanup-stranded in apply mode (bare = apply; omitting --dry-run`,
      `performs a destructive git reset --hard to origin/<base>):`,
      ``,
      `  node scripts/repo/cleanup-stranded.mts --target . --dry-run`,
      `  node scripts/repo/cleanup-stranded.mts --target .`,
      ``,
      `See: docs/agents.md/fleet/stranded-cascades.md`,
    ].join('\n'),
    fixable: false,
    saw: `${total} stranded cascade artifact(s) detected:${commitLines}${worktreeLines}`,
    wanted:
      'no local-only chore(wheelhouse): cascade commits or superseded chore/wheelhouse-<sha> worktrees',
    what: `Stranded cascade artifacts: ${report.strandedCommits.length} commit(s), ${report.strandedWorktrees.length} worktree(s)`,
    where: 'scripts/repo/cleanup-stranded.mts --target . --dry-run',
  }
}
