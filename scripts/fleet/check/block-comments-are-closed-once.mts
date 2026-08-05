#!/usr/bin/env node
/*
 * @file `check --all` gate: no block comment closes earlier than its author
 *   intended. A glob written as star-slash inside a docblock — the shape
 *   `packages/<star>/src/<star><star>` — IS the comment-closing token, so the
 *   block ends mid-sentence and everything after it parses as code. Why raw
 *   text, and why not the lint rule. `socket/no-comment-glob-star-slash`
 *   inspects PARSED comments, and this defect deletes itself from that view: by
 *   the time the parser hands the comment list to a rule, the comment already
 *   ended at the glob, so there is no comment left holding the glob and a
 *   comment visitor has nothing to match. Two more layers fail for their own
 *   reasons — an oxlint rule cannot run at all on a file whose residue is a
 *   syntax error, and `.config/fleet/**` (where the real incident landed) is in
 *   the oxlint ignore list, so no rule there runs ever. Reading the bytes ahead
 *   of any parse is the only vantage point that sees all three. Incident:
 *   `.config/fleet/vitest.coverage.fleet.config.mts` spelled that glob in its
 *   docblock; the block closed early, the tail parsed as code, and tsc reported
 *   `Cannot find name 'src'` plus ten knock-on errors. Eleven errors from one
 *   character sequence, and zero lint findings. Two shapes are reported:
 *
 *   1. A docblock body line (trimmed, opens with a star) that carries a closing
 *      token mid-line. In a well-formed block, only the final line opens with
 *      the close.
 *   2. A one-line block comment whose interior carries a second closing token, so
 *      the first one ends the comment and the rest is stranded. Scope: the
 *      JS/TS family only. Rust block comments NEST, so an inner close is legal
 *      there and a nesting-unaware scan would false-positive; the shared
 *      native-source scanner owns those languages. Generated / vendored
 *      artifacts are skipped via {@link isNeverGated}. The complement, not the
 *      replacement, of `socket/no-comment-glob-star-slash`: that rule catches
 *      the BACKSLASH-ESCAPED glob, which parses fine today and only becomes a
 *      closing token after oxfmt's jsdoc reflow unescapes it. This gate catches
 *      the unescaped form the rule cannot see. Both point at the same fix —
 *      backtick-split the glob, or spell the segment out. Exit 0 — every block
 *      comment closes exactly once; 1 — at least one closes early. Usage: node
 *      scripts/fleet/check/block-comments-are-closed-once.mts [--quiet]
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
 * The two-character sequence that ends a block comment, built at runtime so
 * this file can talk about it without embedding one in its own source.
 */
export const BLOCK_COMMENT_CLOSE = `*${'/'}`

/**
 * The two-character sequence that begins a block comment.
 */
export const BLOCK_COMMENT_OPEN = `${'/'}*`

/**
 * File extensions this gate reads. The JS/TS family only — block comments do
 * not nest there, so the first close is unambiguously THE close.
 */
export const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])

export interface EarlyCloseFinding {
  /**
   * Repo-relative path of the offending file.
   */
  file: string
  /**
   * 1-based line number.
   */
  line: number
  /**
   * Why the line was reported.
   */
  reason: string
  /**
   * The offending line, trimmed, for the report.
   */
  text: string
}

/**
 * True when this gate reads `relPath`: a JS/TS-family source that is not a
 * generated or vendored artifact.
 */
export function isBlockCommentScannedFile(relPath: string): boolean {
  const p = normalizePath(relPath)
  if (!SCANNED_EXTENSIONS.has(path.posix.extname(p))) {
    return false
  }
  return !isNeverGated(p)
}

/**
 * Every line in `text` where a block comment closes before its author meant it
 * to. Pure, line-oriented, and parse-independent — it reads the bytes, so a
 * file that no longer parses is still covered.
 */
export function findEarlyClosedBlockComments(
  relPath: string,
  text: string,
): EarlyCloseFinding[] {
  const out: EarlyCloseFinding[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    const reason = earlyCloseReason(trimmed)
    if (reason) {
      out.push({ file: relPath, line: i + 1, reason, text: trimmed })
    }
  }
  return out
}

/**
 * Why `trimmed` closes a block comment early, or undefined when it does not.
 * Split out so both arms stay readable and independently testable.
 */
export function earlyCloseReason(trimmed: string): string | undefined {
  // Arm 1 — a docblock BODY line. It opens with a star and is not the block's
  // own closing line, so any close it carries ends the comment mid-sentence.
  if (trimmed.startsWith('*') && !trimmed.startsWith(BLOCK_COMMENT_CLOSE)) {
    if (trimmed.includes(BLOCK_COMMENT_CLOSE)) {
      return 'a docblock body line carries a closing token, so the comment ends here and the rest of the line parses as code'
    }
    return undefined
  }
  // Arm 2 — a ONE-LINE block comment. Its interior, between the opener and the
  // final close, must hold no second close.
  if (
    !trimmed.startsWith(BLOCK_COMMENT_OPEN) ||
    !trimmed.endsWith(BLOCK_COMMENT_CLOSE)
  ) {
    return undefined
  }
  const firstClose = trimmed.indexOf(BLOCK_COMMENT_CLOSE, 2)
  const lastClose = trimmed.lastIndexOf(BLOCK_COMMENT_CLOSE)
  if (firstClose < 0 || firstClose === lastClose) {
    return undefined
  }
  // Two genuine comments on one line (or a comment, then code, then a comment)
  // also show two closes. A re-opened comment in the tail proves that shape, so
  // only a tail with no opener at all is a real early close.
  if (trimmed.slice(firstClose + 2).includes(BLOCK_COMMENT_OPEN)) {
    return undefined
  }
  return 'a one-line block comment closes at its first closing token, stranding the rest of the line as code'
}

/**
 * Tracked JS/TS-family source paths under `rootDir`, repo-relative. Reads
 * `git ls-files`, so gitignored trees and submodule contents never appear.
 * Empty on any git failure — a non-git directory is a vacuous pass.
 */
export function trackedBlockCommentFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files'], {
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
    .filter(rel => rel.length > 0 && isBlockCommentScannedFile(rel))
}

/**
 * Scan every tracked JS/TS-family source under `rootDir`.
 */
export function findEarlyClosedBlockCommentsInTree(
  rootDir: string,
): EarlyCloseFinding[] {
  const out: EarlyCloseFinding[] = []
  const files = trackedBlockCommentFiles(rootDir)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text: string
    try {
      text = readFileSync(path.join(rootDir, rel), 'utf8')
    } catch {
      continue
    }
    for (const finding of findEarlyClosedBlockComments(rel, text)) {
      out.push(finding)
    }
  }
  return out
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const findings = findEarlyClosedBlockCommentsInTree(REPO_ROOT)
  if (findings.length === 0) {
    if (!quiet) {
      logger.success('block comments: every block comment closes exactly once.')
    }
    return
  }
  logger.fail(
    `[block-comments-are-closed-once] ${findings.length} block comment(s) close early.`,
  )
  logger.group()
  logger.error(
    'What: a block comment ends at a closing token its author wrote as prose, so the text after it parses as code.',
  )
  logger.error('Where:')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`  ${f.file}:${f.line} — ${f.reason}`)
    logger.error(`    ${f.text}`)
  }
  logger.error(
    'Saw: a second closing token inside the comment; wanted exactly one, at the end.',
  )
  logger.error(
    'Fix: backtick-split the glob so no literal closing token survives, or spell the segment out — `packages/<name>/src` instead of a bare star segment.',
  )
  logger.groupEnd()
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks that no block comment closes earlier than its author intended',
  help: `Usage: node scripts/fleet/check/block-comments-are-closed-once.mts [--quiet]

  --quiet  suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
