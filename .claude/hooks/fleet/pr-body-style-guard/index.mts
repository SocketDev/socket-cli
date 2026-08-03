#!/usr/bin/env node
// Claude Code PreToolUse hook — pr-body-style-guard.
//
// Enforces the operator's standing write-up contract on GitHub PR/issue
// bodies. Fires when a Bash command creates or edits a PR/issue body
// (`gh pr create|edit`, `gh issue create|edit` carrying `--body`/`--body=`/
// `--body-file`, or a bodyless `create` whose body will come from the
// interactive editor). The contract:
//
//   1. Written for a junior dev to follow without prior context.
//   2. Full sentences throughout — no fragment-bullet shorthand.
//   3. Depth (test evidence, implementation notes) behind <details> blocks.
//   4. Cite the existing/precedent behavior the change aligns with.
//   Plus: when the target repo mandates agent disclosure (e.g. pnpm's
//   AGENTS.md), the mandated footer must be present.
//
// The operator had to re-teach this contract session after session ("again
// write at a junior dev level, use <details>, point to existing npm behavior,
// use full sentences — why do I have to keep repeating myself", 2026-07-29,
// pnpm/pnpm#13479). Codified here so no future session needs reminding.
//
// Verdict split:
//   • CLEAN inspectable body → the contract as a REMINDER (exit 0 + stderr).
//   • Deterministic violation → BLOCK (exit 2) naming the violation + fix:
//       - a body longer than ~25 lines with zero <details> blocks;
//       - a fragment-heavy body: among non-empty prose lines (code fences,
//         tables, headings, and pure-markup lines excluded; a list item's
//         CONTENT counts as prose), fewer than half end in sentence
//         punctuation (. ? ! :).
//   • No `--body`/`--body-file` on a `create` → warn-only reminder — the
//     editor-interactive body can't be inspected, and the message says so.
//
// Detection is AST-based (the fleet shell-command parser), so quoting,
// `&&` chains, and `$(…)` are handled and a quoted "gh pr create" inside
// another command's string argument can't false-fire. NOT convention-scoped:
// the contract follows the operator into foreign repos (the incident was a
// pnpm PR), so it fires everywhere.
//
// Bypass: `Allow pr-body-style bypass` (auto-wired via defineHook metadata,
// so the phrase shown is provably the phrase detected, and the exception is
// recorded in the guard-event log).

import { readFileSync } from 'node:fs'

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { GH_VALUE_FLAGS, positionalArgs } from '../_shared/positional-args.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Fast pre-dispatch substrings — the dispatcher skips this hook unless one
// appears in the raw payload.
export const triggers: readonly string[] = ['gh issue', 'gh pr']

// The `gh` subcommands that create or edit a PR/issue body. `comment`,
// `view`, `review`, etc. are out of scope — this guard is about the BODY
// write-up, not every prose surface (convo-prose-nudge covers those).
const BODY_SUBCOMMANDS: ReadonlySet<string> = new Set(['create', 'edit'])
const PR_ISSUE_TOPIC: ReadonlySet<string> = new Set(['issue', 'pr'])

// A body past this many lines with no <details> block reads as a wall of
// text — depth belongs under collapsed sections ("longer than ~25 lines").
const DETAILS_MIN_LINES = 25

// The sentence-ratio heuristic needs a few prose lines to be meaningful; a
// one-line "Fixes the flaky retry test." body is not shorthand evidence.
const RATIO_MIN_PROSE_LINES = 3

// Markdown line shapes that are structure, not prose.
const FENCE_RE = /^\s*(?:```|~~~)/
const HEADING_RE = /^\s{0,3}#{1,6}\s/
const MARKUP_ONLY_RE = /^\s*<[^>]*>\s*$/
const TABLE_RE = /^\s*\|/
// A blockquote and/or list marker prefix — stripped so the item's CONTENT is
// judged as prose (the bullet's sentence counts; the marker does not).
const LINE_PREFIX_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])?\s*/
// require-regex-comment: `[.!?:]` sentence-ending punctuation at end-of-line.
const SENTENCE_END_RE = /[.!?:]$/
// Trailing wrappers that may legitimately follow the sentence-ending
// punctuation: closing parens/brackets/quotes/emphasis, e.g. `…done.)`.
const TRAILING_WRAPPERS_RE = /[)\]"'`*_]+$/

/**
 * Injected file reader for `--body-file` contents — tests pass a stub so the
 * pure planners never touch the filesystem. Returns undefined on any failure.
 */
export type FileReader = (filePath: string) => string | undefined

/**
 * What a `gh pr|issue create|edit` command says about its body. `body` is the
 * inline flag value or the `--body-file` contents; `hasBodyFlag` is true even
 * when the content is unreadable (stdin sentinel, missing file), so the guard
 * can distinguish "no body given" from "body given but uninspectable".
 */
export interface ParsedBody {
  readonly body: string | undefined
  readonly hasBodyFlag: boolean
  readonly subcommand: 'create' | 'edit' | undefined
  readonly topic: 'issue' | 'pr' | undefined
}

/**
 * One deterministic contract violation: what is wrong, and how to fix it.
 */
export interface StyleFinding {
  readonly fix: string
  readonly violation: string
}

const NO_MATCH: ParsedBody = {
  __proto__: null,
  body: undefined,
  hasBodyFlag: false,
  subcommand: undefined,
  topic: undefined,
} as ParsedBody

function readBodyFile(
  filePath: string | undefined,
  readFile: FileReader,
): string | undefined {
  // `-` is gh's stdin sentinel — there is no file to read.
  if (!filePath || filePath === '-') {
    return undefined
  }
  return readFile(filePath)
}

/**
 * Parse the first `gh pr|issue create|edit` segment of `command` for its body
 * content. Pure: the `--body-file` read goes through the injected `readFile`.
 * Returns NO_MATCH (all-undefined, hasBodyFlag false) when no segment targets
 * a PR/issue body.
 */
export function parseBodyFromCommand(
  command: string,
  readFile: FileReader,
): ParsedBody {
  const ghCmds = commandsFor(command, 'gh')
  for (let i = 0, { length } = ghCmds; i < length; i += 1) {
    const cmd = ghCmds[i]!
    // Value-taking flags (--repo X, --body X, …) are dropped WITH their
    // values, so a body value like "create" can never read as a subcommand.
    const nonFlags = positionalArgs(cmd.args, GH_VALUE_FLAGS)
    const topic = nonFlags[0]
    const subcommand = nonFlags[1]
    if (
      topic === undefined ||
      subcommand === undefined ||
      !PR_ISSUE_TOPIC.has(topic) ||
      !BODY_SUBCOMMANDS.has(subcommand)
    ) {
      continue
    }
    let body: string | undefined
    let hasBodyFlag = false
    const { args } = cmd
    for (let k = 0, { length: argCount } = args; k < argCount; k += 1) {
      const arg = args[k]!
      if (arg === '--body' || arg === '-b') {
        hasBodyFlag = true
        body ??= args[k + 1]
      } else if (arg.startsWith('--body=')) {
        hasBodyFlag = true
        body ??= arg.slice('--body='.length)
      } else if (arg === '--body-file' || arg === '-F') {
        hasBodyFlag = true
        body ??= readBodyFile(args[k + 1], readFile)
      } else if (arg.startsWith('--body-file=')) {
        hasBodyFlag = true
        body ??= readBodyFile(arg.slice('--body-file='.length), readFile)
      }
    }
    return {
      __proto__: null,
      body,
      hasBodyFlag,
      subcommand: subcommand as 'create' | 'edit',
      topic: topic as 'issue' | 'pr',
    } as ParsedBody
  }
  return NO_MATCH
}

/**
 * True when `command` writes a PR/issue body this guard should look at: a
 * `gh pr|issue create` with or without a body flag — a bodyless create still
 * opens the interactive editor — or a `gh pr|issue edit` that carries a body
 * flag. An edit that touches only the title is not a body write. Pure — the
 * fire decision never needs file contents.
 */
export function shouldFire(command: string): boolean {
  const parsed = parseBodyFromCommand(command, () => undefined)
  if (parsed.subcommand === undefined) {
    return false
  }
  return parsed.subcommand === 'create' || parsed.hasBodyFlag
}

/**
 * The deterministic contract violations in `body` — the blockable subset of
 * the contract. Two heuristics, both pure and false-positive-hardened:
 *
 * 1. Longer than DETAILS_MIN_LINES lines with zero <details> blocks.
 * 2. Fragment-heavy: among non-empty prose lines (code-fence content and the fence
 *    lines themselves, tables, headings, and pure-markup lines are excluded; a
 *    list item's content counts after its marker is stripped), fewer than half
 *    end in sentence punctuation (. ? ! :) — allowing a trailing closing
 *    paren/quote/emphasis after the punctuation.
 */
export function styleFindings(body: string): StyleFinding[] {
  const findings: StyleFinding[] = []
  const lines = body.split('\n')
  const hasDetails = body.includes('<details')
  if (lines.length > DETAILS_MIN_LINES && !hasDetails) {
    findings.push({
      __proto__: null,
      fix:
        'fold the depth (test evidence, implementation notes, logs) under ' +
        '<details><summary>specific label</summary> blocks — blank line ' +
        'after </summary> so the markdown renders — and keep the verdict ' +
        'and summary up top.',
      violation: `the body is ${lines.length} lines long with zero <details> blocks.`,
    } as StyleFinding)
  }
  let inFence = false
  let proseLines = 0
  let sentenceLines = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    if (FENCE_RE.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    if (
      HEADING_RE.test(raw) ||
      TABLE_RE.test(raw) ||
      MARKUP_ONLY_RE.test(raw)
    ) {
      continue
    }
    const text = raw.replace(LINE_PREFIX_RE, '').trimEnd()
    if (text === '') {
      continue
    }
    proseLines += 1
    if (SENTENCE_END_RE.test(text.replace(TRAILING_WRAPPERS_RE, ''))) {
      sentenceLines += 1
    }
  }
  if (proseLines >= RATIO_MIN_PROSE_LINES && sentenceLines * 2 < proseLines) {
    findings.push({
      __proto__: null,
      fix:
        'rewrite the fragment bullets into full sentences a junior dev can ' +
        'follow without prior context — every prose line should read as a ' +
        'complete statement, not shorthand.',
      violation:
        `only ${sentenceLines} of ${proseLines} prose lines end in sentence ` +
        'punctuation (. ? ! :) — that reads as fragment-bullet shorthand.',
    } as StyleFinding)
  }
  return findings
}

// The four-point contract, restated on every verdict (reminder and block)
// so the fix is always in view.
const CONTRACT_LINES = [
  'The standing write-up contract for PR/issue bodies:',
  '  1. Write for a junior dev to follow with no prior context.',
  '  2. Full sentences throughout — no fragment-bullet shorthand.',
  '  3. Put depth (test evidence, implementation notes) behind <details>',
  '     blocks; keep the verdict and summary up top.',
  '  4. Cite the existing/precedent behavior the change aligns with (e.g.',
  '     "matches what npm already does here", with a pointer).',
  'And: if the target repo mandates agent disclosure (e.g. pnpm AGENTS.md),',
  'the mandated footer must be present in the body.',
]

function fsFileReader(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

export const check = bashGuard(command => {
  if (!shouldFire(command)) {
    return undefined
  }
  const parsed = parseBodyFromCommand(command, fsFileReader)
  const surface = `gh ${parsed.topic} ${parsed.subcommand}`
  if (parsed.body !== undefined) {
    const findings = styleFindings(parsed.body)
    if (findings.length > 0) {
      return block(
        [
          `[pr-body-style-guard] ${surface} blocked — the body violates the`,
          'standing write-up contract:',
          '',
          ...findings.flatMap(f => [`  • ${f.violation}`, `    Fix: ${f.fix}`]),
          '',
          ...CONTRACT_LINES,
          '',
          'Rewrite the body and re-run the command.',
        ].join('\n'),
      )
    }
    return notify(
      [
        `[pr-body-style-guard] ${surface} — reminder before this body posts:`,
        '',
        ...CONTRACT_LINES,
      ].join('\n'),
    )
  }
  // No inspectable body text. A bodyless `create` opens the interactive
  // editor; a present-but-unreadable flag (stdin `-F -`, missing file) is
  // equally opaque. Warn-only either way — there is nothing to inspect.
  const note = parsed.hasBodyFlag
    ? 'The body flag is present but its content could not be read here'
    : 'No --body/--body-file on this create, so the body will come from the'
  const noteTail = parsed.hasBodyFlag
    ? '(stdin or an unreadable file), so it could not be checked.'
    : 'interactive editor, which this hook cannot inspect.'
  return notify(
    [
      `[pr-body-style-guard] ${surface} — reminder (body not inspectable):`,
      '',
      `${note}`,
      `${noteTail} The contract below still applies to what you write:`,
      '',
      ...CONTRACT_LINES,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['pr-body-style'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
