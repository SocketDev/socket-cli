#!/usr/bin/env node
/*
 * @file Belt check: scan committed source for path-string operations on
 *   un-normalized variables. Flags `.test`/`.exec`/`.match`/`.replace` on a
 *   separator regex applied to a path-like variable, and string operations
 *   (`.split('/')` / `.startsWith('…/')` / `.includes('/')`) on a path-like
 *   variable — when neither is preceded by a `normalizePath()` or `toUnixPath()`
 *   call in the same 20-line window. This is the commit-time backlog scanner
 *   paired with the `socket/normalize-path-before-match` lint rule (write-time)
 *   and the `path-regex-normalize-nudge` Stop hook.
 *
 *   The scan is text-based (no full AST parse) — a small false-positive rate is
 *   accepted in exchange for speed; the lint rule is the authoritative gate.
 *
 *   Exit codes:
 *   - 0 — all clean (no un-normalized matches)
 *   - 1 — at least one finding (file:line list emitted to stderr)
 *
 *   Usage: node scripts/fleet/check/paths-are-normalized-before-match.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, sequential gate.
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

// Source-code extensions to scan (TypeScript only — bundled .cjs/.mjs output
// is vendored/generated and intentionally excluded; see git ls-files filter).
// require-regex-comment: source file extension list for committed TS source only.
const SOURCE_FILE_RE = /\.(?:[cm]?tsx?|ts)$/

// Bundled / generated directories to skip.
// require-regex-comment: skip generated bundle, vendor, and node_modules dirs.
const SKIP_DIR_RE =
  /_dispatch\/(?:bundle|snapshot-bundle)\.cjs|\/node_modules\/|\/vendor\/|\/third_party\/|\/upstream\/|\/build\//

// Path-like variable name heuristics (same shape as the lint rule).
// require-regex-comment: path-like variable name suffix/prefix patterns.
const PATH_VAR_IDENT_RE =
  /(?:^|_)(?:path|file|dir|cwd|root|src|dest|target|from|to|base|entry|output|input|abs|rel)(?:_|$)|Path$|File$|Dir$/

// require-regex-comment: matches separator-sensitive ops on a path-like ident.
const SEPARATOR_OP_RE =
  /\b(\w+)\s*\.\s*(?:split\s*\(\s*['"`]\/|startsWith\s*\(\s*['"`]\/|endsWith\s*\(\s*['"`]\/|includes\s*\(\s*['"`]\/|(?:test|exec|match|replace|replaceAll)\s*\(\s*\/(?:\[\/\\\\]|\[\\\\\/]|\\\\))/

// require-regex-comment: matches a normalizePath()/toUnixPath() assignment in the window.
const NORMALIZE_CALL_RE = /\b(?:normalizePath|toUnixPath)\s*\(/

// The hand-rolled backslash→slash rewrite IS a normalization — flagging it
// tells the author to normalize a line that already normalizes. The lint
// rule `prefer-normalize-path` owns nudging this idiom toward normalizePath().
// require-regex-comment: replace/replaceAll of a backslash/dual-separator regex with '/'.
const INLINE_NORMALIZE_IDIOM_RE =
  /\.\s*replace(?:All)?\s*\(\s*\/(?:\\\\|\[\/\\\\]|\[\\\\\/])\/g?\s*,\s*['"`]\//

// require-regex-comment: full-line or block comment lead-in.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/?\*)/

// Test trees embed violation examples inside fixture strings and test names —
// a text scan can't tell those from live code, and the AST lint rule
// (socket/normalize-path-before-match) is the authoritative gate for anything
// vitest-linted anyway. The belt's job is the trees lint doesn't reach.
// require-regex-comment: any test/ or tests/ path segment.
const TEST_TREE_RE = /(?:^|\/)tests?\//

export interface PathFinding {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly varName: string
}

/**
 * Scan the raw text of a source file for un-normalized path operations.
 * Returns one finding per affected line.
 */
export function scan(filePath: string, rawText: string): PathFinding[] {
  const findings: PathFinding[] = []
  const lines = rawText.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    // Text-based scan: commented-out code and doc examples are not findings.
    if (COMMENT_LINE_RE.test(line)) {
      continue
    }
    const m = SEPARATOR_OP_RE.exec(line)
    if (!m) {
      continue
    }
    if (INLINE_NORMALIZE_IDIOM_RE.test(line)) {
      continue
    }
    const varName = m[1] ?? ''
    if (!PATH_VAR_IDENT_RE.test(varName)) {
      continue
    }
    // Look back up to 20 lines for a normalizePath(varName) / toUnixPath(varName) call.
    const windowStart = Math.max(0, i - 20)
    let proven = false
    for (let j = windowStart; j <= i; j += 1) {
      const wLine = lines[j] ?? ''
      if (NORMALIZE_CALL_RE.test(wLine) && wLine.includes(varName)) {
        proven = true
        break
      }
    }
    // Assignment provenance beats proximity: a variable BORN from a
    // normalize call (`const x = normalizePath(…)` anywhere in the file)
    // is normalized at every later use, however far from the assignment.
    if (!proven) {
      const assignRe = new RegExp(
        `\\b${varName}\\s*=\\s*(?:normalizePath|toUnixPath)\\(`,
      )
      for (let j = 0, { length } = lines; j < length; j += 1) {
        if (assignRe.test(lines[j] ?? '')) {
          proven = true
          break
        }
      }
    }
    if (!proven) {
      findings.push({
        file: filePath,
        line: i + 1,
        text: line.trim(),
        varName,
      })
    }
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')

  const lsResult = spawnSync(
    'git',
    ['ls-files', '--', '*.mts', '*.ts', '*.cts'],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    },
  )

  const files: string[] =
    lsResult.status === 0
      ? (typeof lsResult.stdout === 'string'
          ? lsResult.stdout
          : String(lsResult.stdout)
        )
          .split('\n')
          .map(f => f.trim())
          .filter(
            f => f.length > 0 && SOURCE_FILE_RE.test(f) && !SKIP_DIR_RE.test(f),
          )
          .map(f => path.join(REPO_ROOT, f))
      : []

  const allFindings: PathFinding[] = []

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    // Skip the normalize helper itself.
    if (/\/paths\/normalize\.[mc]?[jt]s$/.test(normalizePath(file))) {
      continue
    }
    // Skip this check script itself.
    if (file.endsWith('paths-are-normalized-before-match.mts')) {
      continue
    }
    // Skip test trees — fixture strings + test names embed violation
    // examples the text scan can't distinguish from live code; the AST rule
    // is the authoritative gate there (see TEST_TREE_RE).
    if (TEST_TREE_RE.test(normalizePath(file))) {
      continue
    }
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const findings = scan(file, raw)
    for (let j = 0; j < findings.length; j += 1) {
      allFindings.push(findings[j]!)
    }
  }

  if (allFindings.length === 0) {
    if (!quiet) {
      process.stdout.write(
        '[paths-are-normalized-before-match] all clean — no un-normalized path operations.\n',
      )
    }
    process.exit(0)
  }

  process.stderr.write(
    `[paths-are-normalized-before-match] ${allFindings.length} un-normalized path operation${allFindings.length === 1 ? '' : 's'} found:\n`,
  )
  for (let i = 0; i < allFindings.length; i += 1) {
    const f = allFindings[i]!
    const rel = path.relative(REPO_ROOT, f.file)
    process.stderr.write(`  ${rel}:${f.line}  '${f.varName}' — ${f.text}\n`)
  }
  process.stderr.write(
    '\nPath-like variables used in separator-sensitive operations must be\n' +
      'normalized first via `normalizePath()` from `@socketsecurity/lib/paths/normalize`\n' +
      'or `toUnixPath()` in the 20-line window before the operation.\n\n' +
      'Reference: docs/agents.md/fleet/normalize-path-before-match.md\n',
  )
  process.exit(1)
}

if (isMainModule(import.meta.url)) {
  main()
}
