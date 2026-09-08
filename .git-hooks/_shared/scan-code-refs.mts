// Source-code reference convention scanners: the logger-leak scanner (direct
// console.* / process.std*.write calls) and the cross-repo path scanner
// referencing another fleet repo by an escaping path. Both wrap the shared
// AST / regex detectors so the commit-time and edit-time surfaces agree.

import {
  looksLikeDocumentation,
  splitLines,
  suppressionCoversLine,
} from './scan-core.mts'
// Cross-repo matcher + helpers shared with the edit-time cross-repo-guard.
import {
  CROSS_REPO_ANY_RE,
  relativeTokenEscapesRepo,
  repoNameForFile,
} from './cross-repo.mts'
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

// ── Cross-repo path scanner ────────────────────────────────────────
//
// Two forbidden forms catch the same mistake — referencing another
// fleet repo by a path that escapes the current repo:
//
//   1. `../<fleet-repo>/…`, cross-repo relative. Hardcodes the
//      assumption that both repos are sibling clones under the same
//      projects root; breaks in CI sandboxes / fresh clones / non-
//      standard layouts.
//   2. `<abs-prefix>/projects/<fleet-repo>/…` (cross-repo absolute,
//      where <abs-prefix> isn't already caught by scanPersonalPaths
//      because it uses a placeholder like `${HOME}`).
//
// The right way is to import from the published npm package
// (`@socketsecurity/lib-stable/...`, `@socketsecurity/registry-stable/...`).
// Scanner detects both shapes; suppress with the canonical marker
// `<comment-prefix> oxlint-disable-next-line socket/no-cross-repo-path`.

// CROSS_REPO_ANY_RE (built from the canonical FLEET_REPO_NAMES) is imported
// from the gate-free _shared/cross-repo.mts — the SAME regex the edit-time
// cross-repo-guard uses, sourced from the canonical fleet-repos.mts roster
// (was a divergent inline copy + a stale local repo list).

export const scanCrossRepoPaths = (
  text: string,
  fileAbsPath: string,
): LineHit[] => {
  const currentRepoName = repoNameForFile(fileAbsPath)
  const hits: LineHit[] = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = line.match(CROSS_REPO_ANY_RE)
    if (!m) {
      continue
    }
    // A repo's own paths (`socket-lib/...` referenced from inside
    // socket-lib) are fine — we only catch cross-repo escapes.
    const matched = m[0]
    if (currentRepoName && matched.includes(`/${currentRepoName}`)) {
      continue
    }
    // A relative `..`-traversal that resolves back INSIDE this repo (e.g. an
    // intra-repo `.claude/skills/` import, whose `skills` segment collides with
    // the `skills` fleet-repo name) is not a cross-repo escape.
    if (
      fileAbsPath &&
      matched.includes('..') &&
      !relativeTokenEscapesRepo(matched, fileAbsPath)
    ) {
      continue
    }
    if (looksLikeDocumentation(line, CROSS_REPO_ANY_RE, 'cross-repo')) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: '',
    })
  }
  return hits
}
