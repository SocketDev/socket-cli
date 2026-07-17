/**
 * @file Shared engine for the doc-location guards. plan-location-guard and
 *   report-location-guard gate the same failure mode — a working document
 *   (plan / report) written to a committable path instead of the untracked
 *   `<repo-root>/.claude/<dir>/` home — and differ only in the directory
 *   name, the filename/heading token lists, the bare-dir rule, and the block
 *   message. They share this ONE classifier + check factory so the two can
 *   never drift.
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, editGuard } from './guard.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from './transcript.mts'

import type { GuardCheck } from './guard.mts'

export interface DocLocationGuardOptions {
  /**
   * Also block a bare `<dirName>/` outside `.claude/` (the report guard's
   * extra rule — a tracked top-level `reports/` tree). Defaults to false.
   */
  readonly bareDirBlocked?: boolean | undefined
  /**
   * Build the stderr message for a blocked write. Receives the offending
   * file path and the classification label.
   */
  readonly blockMessage: (filePath: string, classification: string) => string
  readonly bypassPhrase: string
  /**
   * The canonical `.claude/<dirName>/` home: 'plans' or 'reports'.
   */
  readonly dirName: string
  /**
   * Filename-stem tokens that mark a doc as this guard's shape.
   */
  readonly filenameTokens: readonly string[]
  /**
   * First-heading tokens that mark a doc as this guard's shape.
   */
  readonly headingTokens: readonly string[]
}

/**
 * Lowercased filename without extension. Empty string for paths without a
 * basename.
 */
export function basenameStem(filePath: string): string {
  const base = path.basename(filePath)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.toLowerCase()
}

/**
 * Classify the target path against the `.claude/<dirName>/` storage rule.
 * Returns:
 *
 * - `allowed-root-claude-<dirName>` — under the first (root-most)
 *   `.claude/<dirName>/`
 * - `blocked-docs-<dirName>` — under any `docs/<dirName>/`
 * - `blocked-sub-claude-<dirName>` — under a sub-package `.claude/<dirName>/` (a
 *   second, deeper `.claude/<dirName>/`, or one nested under `packages/` /
 *   `apps/` / `crates/`)
 * - `blocked-bare-<dirName>` — under a bare `<dirName>/` outside `.claude/` (only
 *   when `bareDirBlocked`)
 * - `irrelevant` — none of the above
 *
 * Purely lexical on the resolved path. It does NOT walk for a repo root: the
 * fleet rule applies to any matching path regardless of repo context —
 * including a script under /tmp writing into a project tree.
 */
export function classifyDocPath(
  filePath: string,
  dirName: string,
  bareDirBlocked = false,
): string {
  const normalized = normalizePath(filePath)
  const segs = normalized.split('/')

  // Find the FIRST `.claude/<dirName>/` segment pair vs any DEEPER one. The
  // one nearest the root is the canonical operator dir; anything deeper
  // (`<pkg>/.claude/<dirName>/`) is a sub-package dir and is forbidden.
  let firstClaudeIdx = -1
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '.claude' && segs[i + 1] === dirName) {
      firstClaudeIdx = i
      break
    }
  }

  if (firstClaudeIdx !== -1) {
    // Look for a SECOND `.claude/<dirName>/` deeper than the first.
    for (let i = firstClaudeIdx + 2; i < segs.length - 1; i++) {
      if (segs[i] === '.claude' && segs[i + 1] === dirName) {
        return `blocked-sub-claude-${dirName}`
      }
    }
    // Check whether the first `.claude/<dirName>/` is itself nested under
    // another package directory (heuristic: preceded by `packages/`,
    // `apps/`, or `crates/` in the parent path).
    const prefix = segs.slice(0, firstClaudeIdx).join('/')
    if (
      prefix.includes('/packages/') ||
      prefix.includes('/apps/') ||
      prefix.includes('/crates/')
    ) {
      return `blocked-sub-claude-${dirName}`
    }
    return `allowed-root-claude-${dirName}`
  }

  // Look for any `docs/<dirName>/` segment pair.
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'docs' && segs[i + 1] === dirName) {
      return `blocked-docs-${dirName}`
    }
  }

  // A bare `<dirName>/` not under `.claude/` (already handled above).
  if (bareDirBlocked) {
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i] === dirName) {
        return `blocked-bare-${dirName}`
      }
    }
  }

  return 'irrelevant'
}

/**
 * True when the doc's first non-blank line is a markdown heading whose words
 * include one of `headingTokens`.
 */
export function contentLooksLikeDoc(
  content: string | undefined,
  headingTokens: readonly string[],
): boolean {
  if (!content) {
    return false
  }
  // First non-blank line.
  let firstLine = ''
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) {
      firstLine = trimmed.toLowerCase()
      break
    }
  }
  if (!firstLine.startsWith('#')) {
    return false
  }
  return headingTokens.some(token => firstLine.includes(token))
}

/**
 * True when the filename stem contains one of `filenameTokens`.
 */
export function filenameLooksLikeDoc(
  filePath: string,
  filenameTokens: readonly string[],
): boolean {
  const stem = basenameStem(filePath)
  if (!stem) {
    return false
  }
  return filenameTokens.some(token => stem.includes(token))
}

/**
 * Build a doc-location editGuard check: block a `.md` Edit/Write whose path
 * classifies as blocked AND whose filename or opening heading matches the
 * guard's doc shape, unless the bypass phrase appears in a recent user turn.
 * The shape heuristic is intentionally narrow — an unrelated doc that merely
 * lives under a blocked dir passes through for the human to judge.
 */
export function makeDocLocationCheck(
  options: DocLocationGuardOptions,
): GuardCheck {
  const {
    bareDirBlocked = false,
    blockMessage,
    bypassPhrase,
    dirName,
    filenameTokens,
    headingTokens,
  } = options
  return editGuard((filePath, content, payload) => {
    // Only target markdown files.
    if (!filePath.toLowerCase().endsWith('.md')) {
      return undefined
    }

    const classification = classifyDocPath(filePath, dirName, bareDirBlocked)
    if (!classification.startsWith('blocked-')) {
      return undefined
    }

    // Apply the doc-shape heuristic (filename OR opening heading). If
    // neither fires, this is probably a coincidence — let it through and
    // let the human decide.
    const looksLikeDoc =
      filenameLooksLikeDoc(filePath, filenameTokens) ||
      contentLooksLikeDoc(content, headingTokens)
    if (!looksLikeDoc) {
      return undefined
    }

    if (
      bypassPhrasePresent(
        payload.transcript_path,
        bypassPhrase,
        BYPASS_LOOKBACK_USER_TURNS,
      )
    ) {
      return undefined
    }

    return block(blockMessage(filePath, classification))
  })
}
