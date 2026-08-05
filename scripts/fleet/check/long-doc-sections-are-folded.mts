#!/usr/bin/env node
/*
 * @file Long markdown sections carry a `<details>` fold.
 *
 *   THE GOAL IS SCROLL LESS, EXPLORE MORE. A reader should navigate a doc by
 *   opening what they need, not by scrolling past what they do not. A section
 *   that runs past a screen with no fold in it forces the second, and the cost
 *   lands on every future reader rather than the one author who wrote it.
 *
 *   BOTH THRESHOLDS ARE DERIVED FROM A SCREEN, not from a percentile. A
 *   GitHub markdown viewport shows roughly 45 rendered lines. A heading, its
 *   lead prose, and the page chrome take about 15 of those, so:
 *
 *   - MAX_UNFOLDED_LINES (30) — a section body past this pushes the NEXT
 *     heading off screen, which is the moment a reader loses the map of where
 *     they are and starts scrolling to find it.
 *   - MAX_UNFOLDED_CODE_LINES (20) — one fenced block past this fills the
 *     viewport by itself. Code is read by jumping to a line, not top to
 *     bottom, so a long block is the clearest case for folding.
 *
 *   Measured against this repo: at 30 lines, 183 of 591 files carry a section
 *   that needs folding; at 20 lines it is 488, which is most of the corpus and
 *   stops being a signal. On the code side, 8% of the 2206 fenced blocks run
 *   past 20 lines, against 25% past 10 — an 11-line snippet scrolls nothing,
 *   so a limit that low would fold a quarter of every example in the docs.
 *
 *   A fold ANYWHERE in the section satisfies it. The rule asks for a section
 *   that can be navigated, not for a particular shape, and deliberately does
 *   not care which part got folded — the author knows which half is reference
 *   and which is the point.
 *
 *   Bypass: `<!-- wh:fold allow -->` anywhere in the section, for prose that
 *   genuinely has to be read start to finish.
 *
 *   Exit: 0 clean or report-only; 1 when enforcing and a section is unfolded.
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

/**
 * Lines a section may run before it needs a fold. See the file header for how
 * this number was chosen.
 */
export const MAX_UNFOLDED_LINES = 30

/**
 * Lines a single fenced code block may run before it needs a fold. See the
 * file header: one block past this fills the viewport on its own.
 */
export const MAX_UNFOLDED_CODE_LINES = 20

// ENFORCING. The backlog it was report-only for is cleared: 196 sections were
// folded or marked, and the check now runs clean, so a new offender is a NEW
// offender rather than inherited debt. Promoted only after a green run, per the
// repo's own rule that a gate which has never been green must not be made
// required.
export const ENFORCING = true

const HEADING_RE = /^(?:#{2,3}) /
const FOLD_RE = /<details>/
const ALLOW_RE = /<!--\s*wh:fold\s+allow\s*-->/

// Paths the rule does not speak to, each for a different reason.
//
//   - A CHANGELOG is a chronological list. Its length is the record, folding a
//     release's entries hides history, and it is read by searching rather than
//     by reading top to bottom.
//   - `template/base/**` mirrors the live tree byte for byte, so scanning both
//     reports every finding twice and doubles the apparent backlog. The live
//     copy is the one an author edits; the cascade carries the fix across.
//   - Generated or vendored trees have no author to act on the report.
const SKIP_RE =
  /(?:^|\/)(?:CHANGELOG\.md$|CHANGELOG\.[\w-]+\.md$)|^template\/base\/|(?:^|\/)(?:\.agents|_dist|dist|node_modules|vendor)\//

export type UnfoldedSection = {
  file: string
  heading: string
  lines: number
  /**
   * Why it was flagged: the whole section runs long, or one fenced block
   * inside it does. The remedy differs — a long section wants its reference
   * half folded, a long block wants the block itself folded — so the report
   * says which.
   */
  reason: 'section' | 'code-block'
  startLine: number
}

/**
 * The longest fenced block in `lines[from..to)`, in lines including both
 * fences. Zero when the range holds no complete block.
 */
export function longestFence(
  lines: readonly string[],
  from: number,
  to: number,
): number {
  let open = -1
  let longest = 0
  for (let i = from; i < to; i += 1) {
    if (!lines[i]!.startsWith('```')) {
      continue
    }
    if (open === -1) {
      open = i
      continue
    }
    const span = i - open + 1
    if (span > longest) {
      longest = span
    }
    open = -1
  }
  return longest
}

/**
 * Sections in `text` that run past `limit` lines with no fold and no allow
 * marker. Pure, so the suite drives it without a repo.
 *
 * A fenced code block can contain a `#` line that looks like a heading, so
 * fences are tracked and their contents skipped — without that, a shell
 * comment inside an example silently splits one long section into two short
 * ones and the rule stops seeing the thing it exists to catch.
 */
export function findUnfoldedSections(
  file: string,
  text: string,
  limit: number = MAX_UNFOLDED_LINES,
): UnfoldedSection[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!inFence && HEADING_RE.test(line)) {
      starts.push(i)
    }
  }
  const out: UnfoldedSection[] = []
  for (let i = 0, { length } = starts; i < length; i += 1) {
    const start = starts[i]!
    const end = i + 1 < length ? starts[i + 1]! : lines.length
    const span = end - start
    const fence = longestFence(lines, start, end)
    const tooLong = span > limit
    const fenceTooLong = fence > MAX_UNFOLDED_CODE_LINES
    if (!tooLong && !fenceTooLong) {
      continue
    }
    const body = lines.slice(start, end).join('\n')
    if (FOLD_RE.test(body) || ALLOW_RE.test(body)) {
      continue
    }
    out.push({
      file,
      heading: lines[start]!.trim(),
      // Report the number that triggered it, so the line count in the output
      // is the one a reader should compare against the stated limit.
      lines: tooLong ? span : fence,
      reason: tooLong ? 'section' : 'code-block',
      startLine: start + 1,
    })
  }
  return out
}

/**
 * Tracked markdown worth scanning. Sourced from git so vendored and ignored
 * trees never enter the sweep.
 */
export async function trackedMarkdown(): Promise<string[]> {
  const result = await spawn('git', ['ls-files', '-z', '*.md'], {
    cwd: REPO_ROOT,
    stdioString: true,
  })
  return String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
}

export async function main(): Promise<void> {
  const hits: UnfoldedSection[] = []
  const files = await trackedMarkdown()
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
    hits.push(...findUnfoldedSections(rel, text))
  }
  if (!hits.length) {
    logger.success(
      '[long-doc-sections-are-folded] every long section carries a fold.',
    )
    return
  }
  hits.sort((a, b) => b.lines - a.lines)
  const verb = ENFORCING ? 'must carry' : 'should carry'
  const bySection = hits.filter(h => h.reason === 'section').length
  logger.log(
    `[long-doc-sections-are-folded] ${hits.length} section(s) ${verb} a <details> fold ` +
      `(${bySection} past ${MAX_UNFOLDED_LINES} lines, ${hits.length - bySection} with a fenced block past ${MAX_UNFOLDED_CODE_LINES}):`,
  )
  logger.log('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    const what = hit.reason === 'section' ? 'section' : 'code block'
    logger.log(`    ${hit.lines} lines (${what})  ${hit.file}:${hit.startLine}`)
    logger.log(`               ${hit.heading}`)
  }
  logger.log('')
  logger.log(
    '  Scroll less, explore more: fold the reference half behind a <details>',
  )
  logger.log(
    '  whose <summary> names what is inside, so it stays skimmable closed.',
  )
  logger.log(
    '  Prose that must be read start to finish: `<!-- wh:fold allow -->`.',
  )
  if (ENFORCING) {
    process.exitCode = 1
    return
  }
  logger.log('')
  logger.log('  REPORT-ONLY for now — this does not fail the build yet.')
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks long markdown sections carry a <details> fold so a reader explores instead of scrolling',
  help: `Usage: node scripts/fleet/check/long-doc-sections-are-folded.mts`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
