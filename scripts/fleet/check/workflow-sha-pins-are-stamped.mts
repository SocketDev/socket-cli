#!/usr/bin/env node
/*
 * @file `check --all` gate: every `uses: <ref>@<40-hex-sha>` pin in a GitHub
 *   Actions workflow or composite action carries the canonical trailing
 *   `# <label> (YYYY-MM-DD)` staleness comment. The date is the cheapest
 *   staleness signal there is — a reviewer sees at a glance whether a pin was
 *   audited last week or last year, without running a drift audit.
 *   Why a check and not a hook. The edit-time twin
 *   (`.claude/hooks/fleet/workflow-uses-comment-guard/`) is a PreToolUse guard,
 *   so it only ever sees an Edit/Write/MultiEdit payload. A GENERATED workflow
 *   never travels through a tool call — a compiler writes the bytes directly —
 *   so no hook is ever consulted for it and no matcher tightening can change
 *   that. Incident: 37 bare `# v9.0.0` pins landed in a `gh aw compile` output
 *   and the drift only surfaced when the cascade aborted before its mirror
 *   stage, blocking `git push` fleet-wide. A gate that reads the tracked tree
 *   sees generated and hand-written bytes alike.
 *   Scope, and why it is wider than the cascade's own check:
 *
 *   - Workflows at ANY depth: `**​/.github/workflows/*.{yml,yaml}` — the root
 *     tree AND every wheelhouse template layer (`template/base`,
 *     `template/presets`, `template/conditional/*`, `template/overrides/*`). A
 *     preset is SEEDED into a member as its initial file, so an unstamped pin
 *     there propagates fleet-wide.
 *   - Composite actions at ANY depth:
 *     `**​/.github/actions/**​/action.{yml,yaml}`. The fleet layout is
 *     segmented (`.github/actions/{fleet,repo}/<name>/`), so a one-level-deep
 *     probe finds nothing at all.
 *   - Local-action refs (`uses: ./.github/actions/foo`) and unpinned tag refs
 *     carry no SHA and are out of scope (`workflow-sha-pinning` owns those).
 *   - GENERATED artifacts are exempt via the shared {@link isNeverGated}
 *     predicate, not a hand-rolled filename test: a gh-aw `*.lock.yml` is
 *     compiler-owned, rewritten wholesale by every `gh aw compile`, and its
 *     staleness signal is the evergreen `sync-gh-aw-action-pins.mts` recompile
 *     plus the soak gate — not a comment a human maintains. Per
 *     `generated-files-are-never-gated`, those bytes are never gated in any
 *     scope.
 *   - `# socket-lint: allow uses-no-stamp` on the `uses:` line is the one-off
 *     escape hatch, same marker the edit-time guard honors. Exit 0 — every pin
 *     is stamped (or vacuous: no workflows); 1 — at least one bare or malformed
 *     pin comment. Usage: node
 *     scripts/fleet/check/workflow-sha-pins-are-stamped.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isNeverGated } from '../_shared/format-scope.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * A YAML `uses:` line pinning a 40-hex SHA, capturing the ref and any trailing
 * comment. Anchored per line, so callers feed one line at a time.
 */
// oxlint-disable-next-line socket/require-regex-comment -- documented above
export const USES_SHA_PIN_RE =
  /^\s*-?\s*uses:\s+([^\s@]+)@([0-9a-f]{40})(\s*#[^\n]*)?\s*$/

/**
 * The canonical comment: `# <label> (YYYY-MM-DD)`. The label is non-empty and
 * carries no parens of its own, so sloppy trailing junk is rejected too.
 */
// oxlint-disable-next-line socket/require-regex-comment -- documented above
export const PIN_STAMP_COMMENT_RE = /^#\s+\S[^()]*\s+\(\d{4}-\d{2}-\d{2}\)\s*$/

/**
 * The one-off escape hatch, identical to the edit-time guard's marker.
 */
export const PIN_STAMP_ALLOW_MARKER = '# socket-lint: allow uses-no-stamp'

export interface UnstampedPin {
  /**
   * Repo-relative path of the workflow or action file.
   */
  file: string
  /**
   * 1-based line number of the offending `uses:` line.
   */
  line: number
  /**
   * Why the line failed: no comment at all, or a non-canonical one.
   */
  reason: string
  /**
   * The offending line, trimmed, for the report.
   */
  text: string
}

/**
 * True when `relPath` is a workflow or composite-action YAML this gate owns.
 * Generated artifacts (a gh-aw `*.lock.yml`) are excluded by the shared
 * never-gated predicate rather than a local filename test, so the exemption
 * cannot drift from the rest of the fleet's generated-file handling.
 */
export function isPinStampedSurface(relPath: string): boolean {
  const p = normalizePath(relPath)
  if (!/\.ya?ml$/.test(p)) {
    return false
  }
  if (isNeverGated(p)) {
    return false
  }
  // `<anything>/.github/workflows/<one-segment>.yml` — repo root or any
  // wheelhouse template layer, but never a nested subdirectory (Actions does
  // not read those).
  if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) {
    return true
  }
  // `<anything>/.github/actions/<zero-or-more segments>/action.yml` — the
  // `(?:[^/]+\/)*` run is what makes this depth-agnostic, so the SEGMENTED
  // `{fleet,repo}/<name>/` layout is covered as well as a flat `<name>/`.
  return /(?:^|\/)\.github\/actions\/(?:[^/]+\/)*action\.ya?ml$/.test(p)
}

/**
 * Every SHA-pinned `uses:` line in `text` whose trailing comment is missing or
 * does not match `# <label> (YYYY-MM-DD)`, with 1-based line numbers.
 */
export function findUnstampedPins(
  relPath: string,
  text: string,
): UnstampedPin[] {
  const out: UnstampedPin[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line || line.includes(PIN_STAMP_ALLOW_MARKER)) {
      continue
    }
    const match = USES_SHA_PIN_RE.exec(line)
    if (!match) {
      continue
    }
    const comment = (match[3] ?? '').trim()
    let reason: string | undefined
    if (!comment) {
      reason = 'no comment on the pin'
    } else if (!PIN_STAMP_COMMENT_RE.test(comment)) {
      reason = `comment is not \`# <label> (YYYY-MM-DD)\` (got: ${comment})`
    }
    if (reason) {
      out.push({ file: relPath, line: i + 1, reason, text: line.trim() })
    }
  }
  return out
}

/**
 * Tracked workflow + composite-action YAML paths under `rootDir`,
 * repo-relative. Reads `git ls-files`, so gitignored trees and submodule
 * contents never appear, then filters with {@link isPinStampedSurface}. Empty on
 * any git failure — a non-git directory is a vacuous pass, not a crash.
 */
export function trackedPinStampedSurfaces(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '*.yml', '*.yaml'], {
    cwd: rootDir,
    stdio: 'pipe',
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => normalizePath(line.trim()))
    .filter(rel => rel.length > 0 && isPinStampedSurface(rel))
}

/**
 * Scan every tracked workflow + composite action under `rootDir`.
 */
export function findUnstampedPinsInTree(rootDir: string): UnstampedPin[] {
  const out: UnstampedPin[] = []
  const files = trackedPinStampedSurfaces(rootDir)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text: string
    try {
      text = readFileSync(path.join(rootDir, rel), 'utf8')
    } catch {
      continue
    }
    for (const pin of findUnstampedPins(rel, text)) {
      out.push(pin)
    }
  }
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const findings = findUnstampedPinsInTree(REPO_ROOT)
  if (findings.length === 0) {
    if (!quiet) {
      logger.success(
        'workflow SHA pins: every pin carries its `# <label> (YYYY-MM-DD)` stamp.',
      )
    }
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  logger.fail(
    `[workflow-sha-pins-are-stamped] ${findings.length} SHA pin(s) missing the canonical stamp.`,
  )
  logger.group()
  logger.error(
    'What: a SHA-pinned `uses:` line has no `# <label> (YYYY-MM-DD)` staleness comment.',
  )
  logger.error('Where:')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`  ${f.file}:${f.line} — ${f.reason}`)
    logger.error(`    ${f.text}`)
  }
  logger.error(
    'Saw: a bare or malformed pin comment; wanted `# <label> (YYYY-MM-DD)`.',
  )
  logger.error(
    `Fix: append the upstream tag/branch/short-SHA plus the date you pinned it, e.g. \`# v6.4.0 (${today})\`.`,
  )
  logger.error(
    '  The date is the committer date of the pinned SHA — read it with `gh api repos/<owner>/<repo>/commits/<sha> --jq .commit.committer.date`.',
  )
  logger.error(
    `  One-off override: append \`${PIN_STAMP_ALLOW_MARKER}\` to the \`uses:\` line.`,
  )
  logger.groupEnd()
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every workflow/action SHA pin carries the canonical `# <label> (YYYY-MM-DD)` stamp',
  help: `Usage: node scripts/fleet/check/workflow-sha-pins-are-stamped.mts [flags]

  --quiet  suppress the clean-pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
