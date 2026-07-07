// Logger-leak matcher — shared by the commit-time scanLoggerLeaks
// (.git-hooks/_shared/helpers.mts) and the edit-time logger-guard
// (.claude/hooks/fleet/). Both flag direct `console.*` / `process.std*.write`
// calls (the fleet rule: use getDefaultLogger()). Previously the commit side
// used a REGEX and the edit side an AST walk — divergent engines that could
// disagree (a regex flags `console.log` inside a string literal or comment;
// the AST walk does not). This is the single AST-based source so they agree.
//
// AST (acorn-wasm) not regex: the parser is loaded for other commit-time
// checks anyway, and it eliminates the string/comment false positives the
// regex had. Gate-free: imports only the vendored acorn (no Node-25 exit), so
// either hook tree can use it.

import { findMemberCalls } from '../../.claude/hooks/fleet/_shared/acorn/index.mts'

export interface LoggerLeak {
  // 1-based line of the call.
  line: number
  // Source text of the line (trimmed by the caller as needed).
  text: string
  // The dotted call, e.g. `console.log` / `process.stderr.write`.
  fullCall: string
  // Canonical logger replacement, e.g. `logger.info`.
  replacement: string
}

// The forbidden direct-output calls and their canonical logger replacement.
// Two-segment (`console.log`) and three-segment (`process.stderr.write`)
// chains — findMemberCalls handles both via a dotted `object`.
export const FORBIDDEN_LOGGER_CALLS: ReadonlyArray<{
  object: string
  property: string
  replacement: string
}> = [
  { object: 'console', property: 'debug', replacement: 'logger.debug' },
  { object: 'console', property: 'error', replacement: 'logger.error' },
  { object: 'console', property: 'info', replacement: 'logger.info' },
  { object: 'console', property: 'log', replacement: 'logger.info' },
  { object: 'console', property: 'warn', replacement: 'logger.warn' },
  { object: 'process.stderr', property: 'write', replacement: 'logger.error' },
  { object: 'process.stdout', property: 'write', replacement: 'logger.info' },
]

// Find every direct logger-leak call in `source` via the AST. Returns one entry
// per call site with its line, the dotted call, and the canonical replacement.
// Per-line `// socket-lint: allow console` suppression is the CALLER's job
// (each tree applies its own marker semantics).
export function findLoggerLeaks(source: string): LoggerLeak[] {
  const leaks: LoggerLeak[] = []
  for (let i = 0, { length } = FORBIDDEN_LOGGER_CALLS; i < length; i += 1) {
    const spec = FORBIDDEN_LOGGER_CALLS[i]!
    const matches = findMemberCalls(source, spec.object, spec.property)
    for (let j = 0, mlen = matches.length; j < mlen; j += 1) {
      const m = matches[j]!
      leaks.push({
        line: m.line,
        text: m.text,
        fullCall: `${spec.object}.${spec.property}`,
        replacement: spec.replacement,
      })
    }
  }
  return leaks
}

export interface LoggerDecoration {
  // 1-based line of the call.
  line: number
  // Source text of the line.
  text: string
  // The logger method called (e.g. `error`, `fail`, `log`).
  method: string
  // What kind of hand-rolled decoration leads the first argument.
  kind: 'glyph' | 'indent' | 'bullet'
  // For 'glyph': the leading glyph + the logger method that OWNS it (the fix).
  glyph: string | undefined
  ownerMethod: string | undefined
}

// Logger methods whose first string/template arg we inspect for a hand-rolled
// prefix. Excludes structural methods (group/groupEnd/dir/table).
const DECORATION_SCAN_METHODS = [
  'error',
  'fail',
  'info',
  'log',
  'progress',
  'skip',
  'step',
  'substep',
  'success',
  'warn',
]

// Status glyph → the logger method that OWNS it. The method renders the glyph;
// hand-writing it double-marks (and skips theme-aware color). Keep in lockstep
// with @socketsecurity/lib-stable/logger symbols-builder + the no-status-emoji rule.
const GLYPH_OWNER: Readonly<Record<string, string>> = {
  '‼': 'warn',
  '×': 'fail',
  '√': 'success',
  '☑': 'success',
  '⚠': 'warn',
  '⛔': 'warn',
  '✅': 'success',
  '✓': 'success',
  '✔': 'success',
  '✖': 'fail',
  '✗': 'fail',
  '✘': 'fail',
  '❌': 'fail',
  '❎': 'fail',
  '❕': 'warn',
  '❗': 'warn',
  '🚨': 'warn',
  ℹ: 'info',
}

// Leading status glyph (after optional whitespace). One named capture, consumed
// below to look up the owning method. Built dynamically from GLYPH_OWNER so the
// table is the single source.
const GLYPH_LEAD_RE = new RegExp(
  `^\\s*(?<glyph>${Object.keys(GLYPH_OWNER)
    .map(g => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})`,
)
// Leading indentation: a tab or 2+ spaces. The logger owns indentation via
// group()/substep(); a hand-rolled indent fights it.
const INDENT_LEAD_RE = /^(?:\t| {2,})/
// Leading bullet glyph — use logger.substep() for indented sub-items.
const BULLET_LEAD_RE = /^\s*[•‣◦·]\s/

// Find every `logger.<method>(...)` call whose first argument's leading static
// text is hand-rolled decoration the logger/group already owns — a status
// glyph, leading indentation, or a bullet. Works for string literals AND
// template literals (`\`  ✗ ${x}\``). Per-line suppression is the CALLER's job.
export function findLoggerDecoration(source: string): LoggerDecoration[] {
  const out: LoggerDecoration[] = []
  for (let i = 0, { length } = DECORATION_SCAN_METHODS; i < length; i += 1) {
    const method = DECORATION_SCAN_METHODS[i]!
    const calls = findMemberCalls(source, 'logger', method)
    for (let j = 0, clen = calls.length; j < clen; j += 1) {
      const call = calls[j]!
      const lead = call.firstArgLeadingText
      if (typeof lead !== 'string' || lead.length === 0) {
        continue
      }
      const glyphMatch = GLYPH_LEAD_RE.exec(lead)
      const glyph = glyphMatch?.groups?.['glyph']
      if (glyph) {
        out.push({
          __proto__: null,
          line: call.line,
          text: call.text,
          method,
          kind: 'glyph',
          glyph,
          ownerMethod: GLYPH_OWNER[glyph],
        } as LoggerDecoration)
        continue
      }
      if (BULLET_LEAD_RE.test(lead)) {
        out.push({
          __proto__: null,
          line: call.line,
          text: call.text,
          method,
          kind: 'bullet',
          glyph: undefined,
          ownerMethod: undefined,
        } as LoggerDecoration)
        continue
      }
      if (INDENT_LEAD_RE.test(lead)) {
        out.push({
          __proto__: null,
          line: call.line,
          text: call.text,
          method,
          kind: 'indent',
          glyph: undefined,
          ownerMethod: undefined,
        } as LoggerDecoration)
      }
    }
  }
  out.sort((a, b) => a.line - b.line)
  return out
}
