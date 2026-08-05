#!/usr/bin/env node
/*
 * @file `check --all` gate: prose in tracked markdown must not chain spaced
 *   em-dashes. A chain is two or more ` — ` spans on one line, which reads
 *   AI-generated. One em-dash is fine and stays legal.
 *
 *   This is the gate-time twin of the `em-dash chain` pattern in
 *   `.claude/hooks/fleet/anti-prose-guard/patterns.mts`. That hook catches a
 *   chain the moment an agent writes one; this catches a chain that reached the
 *   tree some other way, so the convention holds for a human edit and a
 *   cascaded file too.
 *
 *   Why the pair is the tell. A single dash sets off one clause. Two turn the
 *   sentence into `X — aside — rest`, the dash-parenthetical shape that reads
 *   as machine prose. Note: the fix is a comma pair, a colon, a new sentence,
 *   or a `Note:` sentence when the inserted text is a list of examples. Never
 *   parentheses, because `prose-parenthetical-asides-are-absent` bans those.
 *
 *   Bullet lists are the common source: a registry line like
 *   `- \`name\` — Trigger: description — detail` chains by construction. Write
 *   the leading separator as a plain `-` so the description keeps its one dash.
 *
 *   Escape hatch: `<!-- prose-em-dash: allow -->` on the line, or
 *   `<!-- prose-em-dash: allow-file -->` anywhere in the file.
 *
 *   Scope: tracked `*.md`, minus fixtures dirs and generated CHANGELOGs, the
 *   same surface its aside sibling gates. Code fences, inline spans, and HTML
 *   comments are stripped before matching. An HTML comment carries a machine
 *   marker rather than prose, so a dash inside `<!-- enforcement: … -->` is not
 *   a chain.
 *
 *   `--fix` clears the mechanical half only, in two tiers. First, a list item
 *   whose FIRST dash separates a short label from its description gets a plain
 *   `-` there, the fleet's sanctioned registry-line shape. Second, a dash pair
 *   wrapping a bare APPOSITIVE becomes a comma pair. An appositive opens with a
 *   determiner and carries no comma and no finite verb: `reads node.path — the
 *   node that built it — and stops` becomes `reads node.path, the node that
 *   built it, and stops`.
 *
 *   The fixer stops there. A dash pair wrapping a full CLAUSE would become a
 *   comma splice, so it needs a human's new sentence or `Note:` rewrite.
 *
 *   Usage: node scripts/fleet/check/prose-em-dash-chains-are-absent.mts [--fix] [--quiet]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { collectMarkdownFiles } from './prose-parenthetical-asides-are-absent.mts'

const logger = getDefaultLogger()

export const EM_DASH_ALLOW_LINE = '<!-- prose-em-dash: allow -->'
export const EM_DASH_ALLOW_FILE = '<!-- prose-em-dash: allow-file -->'

// Two spaced em-dashes on one line, the same shape anti-prose-guard matches.
// Lazy middle so the first pair wins rather than the widest span.
const EM_DASH_CHAIN_RE = / — [^\n]*? — /

/**
 * `value` with every `pattern` match replaced, repeated until the string stops
 * changing. Pure.
 *
 * One sweep does not finish the job for a delimited construct, because deleting
 * an inner match splices its neighbours into a fresh one. Stripping the comment
 * from `a <!-<!-- z -->- b — c — d -->` leaves `a <!-- b — c — d -->`, a live
 * comment whose dashes then read as prose and fail the gate. Each pass strictly
 * shortens the string, so the loop always terminates.
 */
function replaceToFixedPoint(
  value: string,
  pattern: RegExp,
  replacement: string,
): string {
  let out = value
  let next = out.replace(pattern, replacement)
  while (next !== out) {
    out = next
    next = out.replace(pattern, replacement)
  }
  return out
}

/**
 * The line reduced to its prose: inline code spans, HTML comments, and
 * dash-only table cells removed. A dash in any of those is not prose, so it
 * must not pair with a real one to form a chain. Pure.
 */
export function toProse(line: string): string {
  // Inline code spans.
  const noSpans = replaceToFixedPoint(line, /`[^`]*`/g, '')
  // HTML comments, which carry machine markers rather than prose.
  const noComments = replaceToFixedPoint(noSpans, /<!--[\s\S]*?-->/g, '')
  // A `| — |` cell is an empty-value placeholder in a table, not an aside.
  return replaceToFixedPoint(noComments, /\|\s*—\s*(?=\||$)/g, '|')
}

/**
 * True when a line chains spaced em-dashes. Pure.
 */
export function hasEmDashChain(line: string): boolean {
  return EM_DASH_CHAIN_RE.test(line)
}

/**
 * One entry per chaining line, 1-based, with the offending text. Honors both
 * escape hatches and skips fenced blocks. Pure over its input.
 */
export function scanEmDashChains(
  content: string,
): Array<{ line: number; text: string }> {
  if (content.includes(EM_DASH_ALLOW_FILE)) {
    return []
  }
  const out: Array<{ line: number; text: string }> = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || raw.includes(EM_DASH_ALLOW_LINE)) {
      continue
    }
    const prose = toProse(raw)
    if (hasEmDashChain(prose)) {
      out.push({ line: i + 1, text: raw.trim().slice(0, 120) })
    }
  }
  return out
}

// A list item's lead: a `- ` / `* ` bullet or a `3. ` ordinal.
const LIST_LEAD_RE = /^\s*(?:[-*]|\d+\.)\s/

// An appositive opens with a determiner, the same shape the parenthetical-aside
// sibling keys on.
const APPOSITIVE_START = /^(?:the|an?|this|that|these|those|its|their|our)\s/i

// A finite verb makes the segment a CLAUSE, not an appositive. Swapping a clause
// to a comma pair makes a splice, so leave it for a human rewrite.
const FINITE_VERB =
  /\b(?:is|are|was|were|has|have|had|does|do|did|will|would|can|could|should|must|writes|wrote|reads|runs|fires|emits|picks|flips|seeds|clicks|means|makes|lets|keeps|gets|goes|comes|needs|takes|provide|provides)\b/i

/**
 * The line with an appositive dash pair swapped to a comma pair, or the line
 * unchanged when the middle segment is not a bare appositive. Pure.
 *
 * The middle must open with a determiner, carry no comma of its own, and carry
 * no finite verb. A prefix is required too: with none, the swap would open the
 * line with a stray comma.
 */
export function fixAppositivePair(line: string): string {
  if (!hasEmDashChain(toProse(line))) {
    return line
  }
  const open = line.indexOf(' — ')
  const close = line.indexOf(' — ', open + 3)
  if (open === -1 || close === -1 || !line.slice(0, open).trim()) {
    return line
  }
  const mid = line.slice(open + 3, close)
  if (
    mid.includes(',') ||
    !APPOSITIVE_START.test(mid) ||
    FINITE_VERB.test(mid)
  ) {
    return line
  }
  return `${line.slice(0, open)}, ${mid}, ${line.slice(close + 3)}`
}

/**
 * The line with its label separator swapped to a plain `-`, or the line
 * unchanged when no mechanical fix applies. Pure.
 *
 * Only a list item qualifies, and only when the text before its first dash is a
 * LABEL rather than a sentence: no sentence-ending punctuation, and short. That
 * keeps the fixer off a dash-parenthetical, which needs a human rewrite.
 */
export function fixLabelSeparator(line: string): string {
  if (!LIST_LEAD_RE.test(line) || !hasEmDashChain(toProse(line))) {
    return line
  }
  const at = line.indexOf(' — ')
  if (at === -1) {
    return line
  }
  // Measure the label WITHOUT the list lead, or an ordinal's own `3. ` period
  // reads as a sentence end and every numbered item gets skipped.
  const label = line.slice(0, at).replace(LIST_LEAD_RE, '')
  // A sentence before the dash means the dash opens an aside, not a label.
  if (/[.!?]\s/.test(label) || label.length > 80) {
    return line
  }
  const fixed = `${line.slice(0, at)} - ${line.slice(at + 3)}`
  // Only accept the swap when it actually breaks the chain.
  return hasEmDashChain(toProse(fixed)) ? line : fixed
}

/**
 * `content` with every mechanically fixable label separator swapped, plus the
 * number of lines changed. Skips fenced blocks, same as the scanner. Pure.
 */
export function fixEmDashChains(content: string): {
  changed: number
  content: string
} {
  const lines = content.split('\n')
  let inFence = false
  let changed = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || raw.includes(EM_DASH_ALLOW_LINE)) {
      continue
    }
    // Label separator first, then the appositive pair. A registry line is the
    // narrower, safer shape, so it wins when both could apply.
    const fixed = fixAppositivePair(fixLabelSeparator(raw))
    if (fixed !== raw) {
      lines[i] = fixed
      changed += 1
    }
  }
  return { changed, content: changed ? lines.join('\n') : content }
}

/**
 * Chaining lines across `files`, formatted `path:line — text`, sorted.
 */
export function scanFilesForChains(
  repoRoot: string,
  files: readonly string[],
): string[] {
  const offenders: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let content: string
    try {
      content = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      continue
    }
    const hits = scanEmDashChains(content)
    for (let j = 0, { length: hlen } = hits; j < hlen; j += 1) {
      offenders.push(`${rel}:${hits[j]!.line} ${hits[j]!.text}`)
    }
  }
  return offenders.toSorted()
}

/**
 * Every em-dash chain across the repo's tracked markdown. Empty when clean.
 */
export function findEmDashChains(repoRoot: string): string[] {
  return scanFilesForChains(repoRoot, collectMarkdownFiles(repoRoot))
}

function main(): number {
  // Non-flag args scope the scan to explicit paths; otherwise the whole tracked
  // markdown tree gates.
  const paths = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const scope = paths.length
    ? paths.toSorted()
    : collectMarkdownFiles(REPO_ROOT)
  if (process.argv.includes('--fix')) {
    let files = 0
    let lines = 0
    for (let i = 0, { length } = scope; i < length; i += 1) {
      const abs = path.join(REPO_ROOT, scope[i]!)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const result = fixEmDashChains(content)
      if (result.changed) {
        writeFileSync(abs, result.content, 'utf8')
        files += 1
        lines += result.changed
      }
    }
    logger.info(
      `[prose-em-dash-chains-are-absent] --fix swapped ${lines} label separator(s) across ${files} file(s).`,
    )
  }
  const offenders = scanFilesForChains(REPO_ROOT, scope)
  if (offenders.length) {
    logger.fail(
      '[prose-em-dash-chains-are-absent] markdown prose chains spaced em-dashes:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  Two dashes make an X — aside — rest sentence, which reads AI-generated.',
    )
    logger.error(
      '  Use a comma pair, a colon, a new sentence, or a Note: sentence for a',
    )
    logger.error(
      '  list of examples. Never parentheses. In a bullet list, write the leading',
    )
    logger.error('  separator as a plain -.')
    logger.error(`  Keep one intentional chain with '${EM_DASH_ALLOW_LINE}'.`)
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[prose-em-dash-chains-are-absent] markdown prose keeps em-dashes unchained.',
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that markdown prose never chains spaced em-dashes on one line',
  help: `Usage: node scripts/fleet/check/prose-em-dash-chains-are-absent.mts [paths...] [flags]
  [paths...]   scope the scan to these files (default: the tracked markdown tree)
  --fix        rewrite fixable em-dash label separators in place
  --quiet      suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
