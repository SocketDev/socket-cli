// Source-code reference convention scanners: the logger-leak scanner (direct
// console.* / process.std*.write calls) and the cross-repo path scanner
// referencing another fleet repo by an escaping path. Both wrap the shared
// AST / regex detectors so the commit-time and edit-time surfaces agree.

import { splitLines, suppressionCoversLine } from './scan-core.mts'
import { scanRepositoryReferences } from './cross-repo.mts'
// Logger-leak detector — AST-based, shared with the edit-time logger-guard.
import { findLoggerLeaks } from './logger-leaks.mts'

import type { LineHit } from './scan-core.mts'

// ── Logger leak scanner ────────────────────────────────────────────
// Source code must call `getDefaultLogger()` from
// `@socketsecurity/lib-stable/logger/default`, not console/process.stdio
// directly. Two leak shapes, each with its own opt-out marker so a reviewer
// can tell which exemption was granted:
//   - `console.{log,error,warn,info,debug}` → marker
//     `// oxlint-disable-next-line socket/no-console-prefer-logger` (`allow logger` accepted as a legacy
//     alias for one deprecation cycle).
//   - `process.std{out,err}.write` → marker `// oxlint-disable-next-line
//     process-stdio`, reserved for a CLI whose stdio IS a protocol a caller
//     parses back, where a logger prefix would corrupt the bytes.
// Doc-context lines are exempt from both. AST-based via the shared
// findLoggerLeaks (acorn) — the SAME detector the edit-time logger-guard
// uses, so the two surfaces can't disagree (a regex would flag console.log
// inside a string/comment; the AST walk does not). scanLoggerLeaks merges
// both passes into one entry point for pre-commit/pre-push callers.

// Map each direct call to its lib-logger equivalent (used for the `suggested`
// rewrite a hit carries). process.stdout / console.log / console.info →
// logger.info; process.stderr / console.error → logger.error; etc.
export function suggestLoggerReplacement(line: string): string {
  return line
    .replace(/\bprocess\.stderr\.write\s*\(/g, 'logger.error(')
    .replace(/\bprocess\.stdout\.write\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.error\s*\(/g, 'logger.error(')
    .replace(/\bconsole\.warn\s*\(/g, 'logger.warn(')
    .replace(/\bconsole\.info\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.debug\s*\(/g, 'logger.debug(')
    .replace(/\bconsole\.log\s*\(/g, 'logger.info(')
}

// Merged entry point: every console.* / process.std*.write leak, deduped by
// line. Per-line `// oxlint-disable-next-line socket/no-console-prefer-logger` (or `allow process-stdio` for
// the stdio form) suppresses a hit, matching the old skipDocs semantics.
export function scanLoggerLeaks(text: string): LineHit[] {
  const lines = splitLines(text)
  const byLine = new Map<number, LineHit>()
  for (const leak of findLoggerLeaks(text)) {
    if (byLine.has(leak.line)) {
      continue
    }
    const sourceLine = lines[leak.line - 1] ?? ''
    const rule = leak.fullCall.startsWith('process.')
      ? 'process-stdio'
      : 'console'
    if (suppressionCoversLine(lines, leak.line - 1, rule)) {
      continue
    }
    byLine.set(leak.line, {
      lineNumber: leak.line,
      line: sourceLine,
      suggested: suggestLoggerReplacement(sourceLine),
    })
  }
  return [...byLine.values()].toSorted((a, b) => a.lineNumber - b.lineNumber)
}

export function scanCrossRepoPaths(
  text: string,
  fileAbsPath: string,
): LineHit[] {
  return scanRepositoryReferences(text, fileAbsPath).map(hit => ({
    __proto__: null,
    lineNumber: hit.lineNumber,
    line: hit.line,
    suggested: '',
  }))
}
