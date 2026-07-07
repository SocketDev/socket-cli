#!/usr/bin/env node
/**
 * @file Detect + AI-restore JSDoc comments the formatter flattened.
 *
 *   1. PROBLEM — oxfmt's `jsdoc` formatter re-wraps description prose. Even in the
 *      fleet's `lineWrappingStyle: "balance"` mode it collapses blank-line
 *      section breaks and merges section headings onto a wrapped prose tail, so
 *      a hand-structured `@file` doc loses its SHAPE (the content survives, but
 *      a reader leans on the shape). This file is itself written in the
 *      fixpoint shape it enforces — sections as a numbered list, which oxfmt
 *      leaves untouched.
 *   2. LAYERS — code-as-law in two parts. Layer 1 (config): the fleet oxfmtrc uses
 *      `balance`, the least-destructive mode oxfmt offers. Layer 2 (this
 *      script): detect the residual flattening + steer the rebuild toward a
 *      shape that is both readable AND an oxfmt fixpoint (so it is not
 *      re-flattened on the next format).
 *   3. DETECTION — pure, no AI, no false-positive on clean docs. A long
 *      description line is flagged when a section heading was flattened onto
 *      its tail: a sentence-ending `.` then an all-caps word that is
 *      colon-tagged (`provenance. USAGE:`) or the trailing token (`falsifiable.
 *      CORPUS`). Emphasis/acronyms followed by lowercase prose do not trip it;
 *      a heading at line start (`PURPOSE. Produce …`) is the intended shape.
 *   4. RESTORE — AI, opt-in via `--fix`. spawnAiAgent under AI_PROFILE.edit (Edit
 *      and Read tools only; no Bash, no Write — the four-flag
 *      Programmatic-Claude lockdown) rewrites the flagged comment into the
 *      numbered-list fixpoint.
 *   5. USAGE — `node scripts/fleet/restore-jsdoc.mts <file>... [--check] [--fix]
 *      [--json]`. `--check` (default) detects + reports, exit 1 if any file is
 *      mangled. `--fix` spawns the restore agent per flagged file. With no
 *      files, scans tracked `.mts`/`.ts` under `src/` + `scripts/`.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// The print width the fleet oxfmtrc wraps at; a description line at/over this
// was wrapped by the formatter, not hand-authored that long.
const PRINT_WIDTH = 80

export interface MangleFinding {
  // 1-based line of the offending comment description line.
  readonly line: number
  // Why it was flagged (for the report + the restore prompt).
  readonly reason: string
  readonly text: string
}

export interface FileResult {
  readonly file: string
  readonly findings: readonly MangleFinding[]
}

// Extract block-comment (`/** ... */`) description lines (the ` * ...` bodies)
// with their absolute 1-based line numbers.
export function blockCommentLines(
  source: string,
): { line: number; text: string }[] {
  const lines = source.split('\n')
  const out: { line: number; text: string }[] = []
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const trimmed = lines[i]!.trim()
    if (trimmed.startsWith('/**')) {
      inBlock = true
    }
    if (inBlock && trimmed.startsWith('*')) {
      // Strip the leading `* ` to get the description content.
      out.push({ line: i + 1, text: trimmed.replace(/^\*\s?/u, '') })
    }
    if (trimmed.endsWith('*/')) {
      inBlock = false
    }
  }
  return out
}

// The flatten signature oxfmt actually produces: a section HEADING gets pulled
// onto the tail of the previous paragraph's last wrapped line. Match a
// sentence-ending `.` followed by an all-caps word that is EITHER colon-tagged
// (`provenance. USAGE:`) OR the trailing token where the wrap broke
// (`falsifiable. CORPUS$`, `offline. WHAT$`). An uppercase word followed by
// more lowercase prose on the same line is emphasis or an acronym (`. THIS is
// the default`, `. OTP resolution`), NOT an orphaned heading — so it must be
// `:` or end-of-line, never mid-sentence. A heading at line START (`PURPOSE.
// Produce …`) is the intended shape and never matches.
const ORPHANED_HEADING_RE = /[.]\s+[A-Z]{3,}(?::\s|\s*$)/u
// An ordered-list item pulled AFTER other prose on the same line (`… word. 1.
// item … 2. item …`) — the list got sucked up into a paragraph.
const INLINE_LIST_RE = /\S.+\b\d+\.\s+\S.*\b\d+\.\s+\S/u

export function detectMangled(source: string): MangleFinding[] {
  const findings: MangleFinding[] = []
  for (const { line, text } of blockCommentLines(source)) {
    // Only long lines — a short, intentional one-section line never trips.
    if (text.length < PRINT_WIDTH - 10) {
      continue
    }
    if (ORPHANED_HEADING_RE.test(text)) {
      findings.push({
        line,
        reason: 'a section heading was flattened onto a prose tail',
        text: text.slice(0, 100),
      })
      continue
    }
    if (INLINE_LIST_RE.test(text)) {
      findings.push({
        line,
        reason: 'ordered-list items pulled into a prose run',
        text: text.slice(0, 100),
      })
    }
  }
  return findings
}

export function trackedSourceFiles(): string[] {
  const res = spawnSync(
    'git',
    ['ls-files', 'src/*.mts', 'src/*.ts', 'scripts/*.mts'],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  return String(res.stdout ?? '')
    .split('\n')
    .filter(Boolean)
}

export async function restoreFile(file: string): Promise<boolean> {
  const prompt = [
    `The JSDoc @file comment in ${file} was flattened by the code formatter.`,
    'Rewrite ONLY that block comment into the fleet canonical @file shape — the',
    'ONLY multi-section form oxfmt leaves untouched (a proven fixpoint). Follow',
    'this EXACTLY:',
    '',
    '  - Line 1 is `@file <one-line summary>` and nothing else.',
    '  - Then ONE blank ` *` line.',
    '  - Then EVERY section becomes a NUMBERED LIST ITEM. There must be ZERO',
    '    prose-heading sections left. Each ALL-CAPS heading that currently sits',
    '    in the prose (PURPOSE, CORPUS, WHAT IT MEASURES, RESTORE, USAGE, …)',
    '    becomes the start of its own numbered item:',
    "        1. PURPOSE — <that section's text>.",
    "        2. CORPUS — <that section's text>.",
    "        3. USAGE — <that section's text>.",
    '    Do NOT leave any heading as a sentence inside a paragraph. If a section',
    '    has its own sub-list (1./2./a./-), nest it as indented continuation',
    '    lines UNDER its parent numbered item.',
    `  - Keep every line at or under ${PRINT_WIDTH} columns including the leading`,
    '    ` * `. Preserve all wording and facts; invent nothing, drop nothing.',
    '',
    'CHECK before you finish: no ALL-CAPS heading word may appear mid-sentence or',
    'glued to the end of a prose line — each is the first word of a list item.',
    'Touch only the comment. Do not change any code. After editing, stop.',
  ].join('\n')
  const { exitCode, stderr } = await spawnAiAgent({
    ...AI_PROFILE.edit,
    effort: 'low',
    prompt,
    timeoutMs: 3 * 60 * 1000,
  })
  if (exitCode !== 0) {
    logger.fail(
      `restore agent exited ${exitCode} for ${file}: ${stderr.slice(0, 300)}`,
    )
    return false
  }
  return true
}

export interface RunOptions {
  readonly files: readonly string[]
  readonly fix: boolean
  readonly json: boolean
}

export function parseArgs(argv: readonly string[]): RunOptions {
  const files: string[] = []
  let fix = false
  let json = false
  for (const arg of argv) {
    if (arg === '--fix') {
      fix = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--check') {
      fix = false
    } else if (!arg.startsWith('-')) {
      files.push(arg)
    }
  }
  return { files, fix, json }
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const targets = options.files.length ? options.files : trackedSourceFiles()
  const results: FileResult[] = []
  for (const file of targets) {
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const findings = detectMangled(source)
    if (findings.length) {
      results.push({ file, findings })
    }
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(results, undefined, 2)}\n`) // socket-lint: allow console -- machine JSON
    return
  }
  if (results.length === 0) {
    logger.success('No mangled JSDoc detected.')
    return
  }
  for (const r of results) {
    logger.warn(`${r.file}: ${r.findings.length} flattened comment line(s)`)
    for (const f of r.findings) {
      logger.log(`  ${r.file}:${f.line} — ${f.reason}`)
    }
  }
  if (!options.fix) {
    logger.fail(
      `${results.length} file(s) with flattened JSDoc. Re-run with --fix to AI-restore, or rewrite by hand keeping each line ≤${PRINT_WIDTH} cols.`,
    )
    process.exitCode = 1
    return
  }
  for (const r of results) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await restoreFile(r.file)
    if (ok) {
      logger.success(`Restored ${r.file}`)
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
