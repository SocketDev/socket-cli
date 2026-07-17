// Fleet tool — validate a DRAFT PR review comment against the fleet comment
// format before it is posted (docs/agents.md/fleet/pr-review-comments.md).
//
// The format exists so a reviewer can triage a comment at a glance: one
// `<details>` fold-out per major finding, a severity circle with `<abbr>`
// hover text on every summary, sections sorted most-severe first, numeric
// references that carry their item's title, `Fix idea 💡:` labels, and no AI
// attribution. This script checks the MECHANICAL half of the doc; the
// judgment half (junior-dev comprehension, no bot repetition, duplicate-PR
// scan, verified-findings-only) stays with the author.
//
// Usage: node scripts/fleet/lint-pr-comment.mts <draft.md> [--quiet]
//        gh pr view 123 --json body --jq .body | node scripts/fleet/lint-pr-comment.mts -

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface CommentViolation {
  readonly fix: string
  readonly line: number
  readonly rule: string
  readonly saw: string
  readonly wanted: string
}

export const SEVERITY_LABELS: ReadonlyMap<string, string> = new Map([
  ['🔴', 'Critical: fix before merge/run'],
  ['🟠', 'Significant: should be addressed'],
  ['🟡', 'Moderate/minor: worth addressing'],
  ['🟢', 'Verified fine / informational'],
])

export const SEVERITY_RANKS: ReadonlyMap<string, number> = new Map([
  ['🔴', 0],
  ['🟠', 1],
  ['🟡', 2],
  ['🟢', 3],
])

// Strings whose presence marks AI attribution on a GitHub prose surface —
// banned fleet-wide on commits AND comments.
const AI_ATTRIBUTION_PATTERN =
  /co-authored-by:\s*claude|generated with \[?claude|🤖 generated/i

// A well-formed summary line: optional `<a name="...">` anchor (kept inside
// the summary so the link target stays reachable while the block is
// collapsed), an `<abbr>`-wrapped severity circle, then a bolded title.
const SUMMARY_SHAPE =
  /^<summary>(?:<a name="([a-z0-9-]+)"><\/a>)?<abbr title="([^"]+)">(🔴|🟠|🟡|🟢|\S+)<\/abbr> <b>(.+)<\/b><\/summary>$/u

// A numeric item/finding reference. The reference must be followed by its
// item's short title in italics — either ` _(title)_` or `, _title_` — with an
// optional markdown-link tail (`[2](#user-content-finding-2)`) in between.
const NUMERIC_REF_PATTERN = /\b(?:item|finding)s?\s+\[?(\d+)\]?(\(#[^)]*\))?/gi

const TITLED_REF_TAIL = /^,?\s*_\(?/

interface SummaryEntry {
  readonly anchor: string | undefined
  readonly circle: string | undefined
  readonly hover: string | undefined
  readonly line: number
  readonly title: string | undefined
}

// Blank out fenced code blocks (preserving line count) so example snippets
// inside a comment can't trip the scanners.
export function stripCodeFences(body: string): string {
  const lines = body.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      lines[i] = ''
      continue
    }
    if (inFence) {
      lines[i] = ''
    }
  }
  return lines.join('\n')
}

function collectSummaries(lines: string[]): SummaryEntry[] {
  const entries: SummaryEntry[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line.startsWith('<summary>')) {
      continue
    }
    const match = SUMMARY_SHAPE.exec(line)
    if (!match) {
      entries.push({
        anchor: undefined,
        circle: undefined,
        hover: undefined,
        line: i + 1,
        title: undefined,
      })
      continue
    }
    entries.push({
      anchor: match[1],
      circle: match[3],
      hover: match[2],
      line: i + 1,
      title: match[4],
    })
  }
  return entries
}

function lintSummaries(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  const summaries = collectSummaries(lines)
  let previousRank = -1
  let expectedNumber = 1
  for (const summary of summaries) {
    if (
      summary.circle === undefined ||
      summary.hover === undefined ||
      summary.title === undefined
    ) {
      violations.push({
        fix: 'shape it as <summary><a name="finding-N"></a><abbr title="<canonical label>">🔴|🟠|🟡|🟢</abbr> <b>Title</b></summary>',
        line: summary.line,
        rule: 'summary-shape',
        saw: 'a <summary> without an <abbr>-wrapped severity circle and bolded title',
        wanted: 'anchor? + <abbr title>circle</abbr> + <b>title</b>',
      })
      continue
    }
    const canonicalHover = SEVERITY_LABELS.get(summary.circle)
    if (canonicalHover === undefined) {
      violations.push({
        fix: 'use one of 🔴 🟠 🟡 🟢',
        line: summary.line,
        rule: 'severity-circle',
        saw: `circle ${summary.circle}`,
        wanted: 'one of the four severity circles',
      })
      continue
    }
    if (summary.hover !== canonicalHover) {
      violations.push({
        fix: `set the abbr title to "${canonicalHover}"`,
        line: summary.line,
        rule: 'hover-label',
        saw: `abbr title "${summary.hover}" on ${summary.circle}`,
        wanted: `"${canonicalHover}"`,
      })
    }
    const rank = SEVERITY_RANKS.get(summary.circle)!
    if (rank < previousRank) {
      violations.push({
        fix: 'reorder the <details> sections most-severe first (🔴, 🟠, 🟡, 🟢) and renumber titles to match',
        line: summary.line,
        rule: 'severity-order',
        saw: `${summary.circle} section after a less severe one`,
        wanted: 'non-increasing severity from top to bottom',
      })
    }
    previousRank = Math.max(previousRank, rank)
    const numbered = /^(\d+)\.\s/.exec(summary.title)
    if (numbered) {
      const n = Number(numbered[1])
      if (n !== expectedNumber) {
        violations.push({
          fix: 'renumber titles sequentially in the sorted order',
          line: summary.line,
          rule: 'sequential-numbering',
          saw: `title number ${n}`,
          wanted: `${expectedNumber}`,
        })
      }
      expectedNumber += 1
    }
  }
  return violations
}

function lintFixIdeaLabels(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/Fix idea\s*:/.test(line) && !/Fix idea 💡:/.test(line)) {
      violations.push({
        fix: 'write it as "Fix idea 💡:"',
        line: i + 1,
        rule: 'fix-idea-bulb',
        saw: '"Fix idea:" without the bulb',
        wanted: '"Fix idea 💡:"',
      })
    }
  }
  return violations
}

function lintNumericRefs(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimStart().startsWith('<summary>')) {
      // Titles number themselves; only prose references need a title tail.
      continue
    }
    for (const match of line.matchAll(NUMERIC_REF_PATTERN)) {
      const tail = line.slice(match.index + match[0].length)
      if (!TITLED_REF_TAIL.test(tail)) {
        violations.push({
          fix: `follow the reference with the item's short title in italics, e.g. "item ${match[1]} _(list-route threshold)_"`,
          line: i + 1,
          rule: 'titled-reference',
          saw: `bare reference "${match[0].trim()}"`,
          wanted: 'item N _(short title)_',
        })
      }
    }
  }
  return violations
}

// Intra-comment anchor links don't work on GitHub: navigating to a fragment
// inside a collapsed <details> neither opens nor scrolls to it. Findings stay
// in their fold-outs — the severity circles are the map, and numeric
// references use the plain `item N _(title)_` form.
function lintNoAnchorLinks(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (/\]\(#[a-z0-9-]+\)/.test(lines[i]!)) {
      violations.push({
        fix: 'drop the link — reference the finding as plain `item N _(short title)_`; the circles carry the map',
        line: i + 1,
        rule: 'no-anchor-links',
        saw: 'an intra-comment fragment link',
        wanted:
          'no fragment links — GitHub cannot open a collapsed <details> from one',
      })
    }
    if (/<a name="[a-z0-9-]+">/.test(lines[i]!)) {
      violations.push({
        fix: 'remove the <a name> anchor — nothing may link to it',
        line: i + 1,
        rule: 'no-anchor-links',
        saw: 'an <a name> anchor',
        wanted: 'no anchors — findings live in their <details> unlinked',
      })
    }
  }
  return violations
}

// Fold-out bodies read better indented under their summary; a <blockquote>
// wrapper is GitHub's native way to indent a <details> body. Require the
// first non-blank line after </summary> to open one and the last non-blank
// line before </details> to close it.
function lintDetailsIndent(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // A line whose trimmed content is exactly `</summary>`, or ends with
    // `</summary>` optionally followed by whitespace (inline close).
    if (!/^<\/summary>$|<\/summary>\s*$/.test(lines[i]!.trim())) {
      continue
    }
    let j = i + 1
    while (j < length && lines[j]!.trim() === '') {
      j += 1
    }
    if (j < length && !lines[j]!.trim().startsWith('<blockquote>')) {
      violations.push({
        fix: 'open the fold-out body with <blockquote> on the line after </summary> and close it with </blockquote> before </details>',
        line: j + 1,
        rule: 'details-body-blockquote',
        saw: `fold-out body starts with ${JSON.stringify(lines[j]!.trim().slice(0, 40))}`,
        wanted: 'details body wrapped in <blockquote> so it renders indented',
      })
    }
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i]!.trim() !== '</details>') {
      continue
    }
    let j = i - 1
    while (j >= 0 && lines[j]!.trim() === '') {
      j -= 1
    }
    if (j >= 0 && !lines[j]!.trim().endsWith('</blockquote>')) {
      violations.push({
        fix: 'close the fold-out body with </blockquote> on the line before </details>',
        line: i + 1,
        rule: 'details-body-blockquote',
        saw: `fold-out body ends with ${JSON.stringify(lines[j]!.trim().slice(-40))}`,
        wanted: 'details body wrapped in <blockquote> so it renders indented',
      })
    }
  }
  return violations
}

// A severity-circle bullet: `- ` then an `<abbr>` with hover text wrapping a
// severity emoji (🔴/🟠/🟡/🟢) or any non-whitespace glyph, then a space.
const BULLET_CIRCLE_SHAPE =
  /^- <abbr title="([^"]+)">(🔴|🟠|🟡|🟢|\S+)<\/abbr> /u

// Inside a "Smaller items" fold, every bullet carries its OWN severity circle
// (with canonical hover text), and the fold's summary circle matches the most
// severe bullet inside it.
function lintSmallerItems(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  let foldCircle: string | undefined
  let foldLine = 0
  let mostSevereRank = Number.POSITIVE_INFINITY
  let inFold = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line.startsWith('<summary>') && line.includes('Smaller items')) {
      const match = SUMMARY_SHAPE.exec(line)
      foldCircle = match?.[3]
      foldLine = i + 1
      inFold = true
      mostSevereRank = Number.POSITIVE_INFINITY
      continue
    }
    if (!inFold) {
      continue
    }
    if (line.startsWith('</details>')) {
      const foldRank =
        foldCircle === undefined ? undefined : SEVERITY_RANKS.get(foldCircle)
      if (
        foldRank !== undefined &&
        Number.isFinite(mostSevereRank) &&
        foldRank !== mostSevereRank
      ) {
        const wantedCircle = [...SEVERITY_RANKS.entries()].find(
          ([, rank]) => rank === mostSevereRank,
        )![0]
        violations.push({
          fix: `set the fold's summary circle to ${wantedCircle} (its most severe bullet)`,
          line: foldLine,
          rule: 'fold-circle-matches-bullets',
          saw: `fold circle ${foldCircle} over bullets whose most severe is ${wantedCircle}`,
          wanted: 'fold circle == most severe bullet circle',
        })
      }
      inFold = false
      continue
    }
    if (!line.startsWith('- ')) {
      continue
    }
    const bullet = BULLET_CIRCLE_SHAPE.exec(line)
    if (!bullet) {
      violations.push({
        fix: 'start the bullet with its own <abbr title="<canonical label>">circle</abbr>',
        line: i + 1,
        rule: 'bullet-circle',
        saw: 'a Smaller-items bullet without a severity circle',
        wanted: '- <abbr title="...">🔴|🟠|🟡|🟢</abbr> <text>',
      })
      continue
    }
    const canonicalHover = SEVERITY_LABELS.get(bullet[2]!)
    if (canonicalHover === undefined) {
      violations.push({
        fix: 'use one of 🔴 🟠 🟡 🟢',
        line: i + 1,
        rule: 'severity-circle',
        saw: `bullet circle ${bullet[2]}`,
        wanted: 'one of the four severity circles',
      })
      continue
    }
    if (bullet[2] === '🔴') {
      violations.push({
        fix: 'promote the bullet to its own <details> section — critical findings are never "smaller items"',
        line: i + 1,
        rule: 'no-critical-smaller-item',
        saw: 'a 🔴 bullet inside the Smaller items fold',
        wanted: 'smaller items are 🟠, 🟡, or 🟢 only',
      })
      continue
    }
    if (bullet[1] !== canonicalHover) {
      violations.push({
        fix: `set the abbr title to "${canonicalHover}"`,
        line: i + 1,
        rule: 'hover-label',
        saw: `abbr title "${bullet[1]}" on ${bullet[2]}`,
        wanted: `"${canonicalHover}"`,
      })
    }
    mostSevereRank = Math.min(
      mostSevereRank,
      SEVERITY_RANKS.get(bullet[2]!) ?? Number.POSITIVE_INFINITY,
    )
  }
  return violations
}

function lintAiAttribution(lines: string[]): CommentViolation[] {
  const violations: CommentViolation[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (AI_ATTRIBUTION_PATTERN.test(lines[i]!)) {
      violations.push({
        fix: 'delete the attribution line — GitHub prose surfaces carry no AI attribution',
        line: i + 1,
        rule: 'no-ai-attribution',
        saw: 'an AI attribution marker',
        wanted: 'no attribution',
      })
    }
  }
  return violations
}

export function lintPrReviewComment(body: string): CommentViolation[] {
  const stripped = stripCodeFences(body)
  const lines = stripped.split('\n')
  return [
    ...lintSummaries(lines),
    ...lintFixIdeaLabels(lines),
    ...lintNumericRefs(lines),
    ...lintSmallerItems(lines),
    ...lintNoAnchorLinks(lines),
    ...lintDetailsIndent(lines),
    ...lintAiAttribution(lines),
  ].toSorted((a, b) => a.line - b.line)
}

function readInput(target: string): string {
  if (target === '-' || target === '--stdin') {
    return readFileSync(0, 'utf8')
  }
  return readFileSync(target, 'utf8')
}

function main(): void {
  const args = process.argv.slice(2).filter(a => a !== '--quiet')
  const quiet = process.argv.includes('--quiet')
  const target = args[0]
  if (!target) {
    logger.fail(
      '[lint-pr-comment] no input. Where: CLI args. Saw: no file path. Wanted: a draft path or "-" for stdin. Fix: node scripts/fleet/lint-pr-comment.mts <draft.md>',
    )
    process.exitCode = 1
    return
  }
  const body = readInput(target)
  const violations = lintPrReviewComment(body)
  if (violations.length) {
    logger.fail(
      `[lint-pr-comment] ${violations.length} format violation(s) in ${target === '-' ? 'stdin' : target}:`,
    )
    for (const v of violations) {
      logger.error(
        `  ✗ line ${v.line} [${v.rule}] saw ${v.saw}; wanted ${v.wanted}. Fix: ${v.fix}`,
      )
    }
    logger.error(
      '  Format spec: docs/agents.md/fleet/pr-review-comments.md — fix the draft, then re-run before posting.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[lint-pr-comment] draft matches the fleet PR review comment format.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
