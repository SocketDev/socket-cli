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
