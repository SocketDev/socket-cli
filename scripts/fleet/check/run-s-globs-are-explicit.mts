#!/usr/bin/env node
/*
 * @file Fleet-wide check: every `package.json` scripts block must not contain a
 *   `run-s <prefix>:*` or `run-p <prefix>:*` glob suffix in an aggregator value.
 *   npm-run-all2 resolves `:*` globs via `Object.keys(scripts)`, which follows
 *   ECMA-262 OrdinaryOwnPropertyKeys §10.1.11 — package.json SOURCE ORDER, not
 *   alphabetical. An order-dependent aggregator using a glob runs tasks in the
 *   order they were written; reordering or inserting a script entry silently
 *   breaks the aggregator. CLAUDE.md "npm-run-all-ordering".
 *
 *   A glob is annotated as order-independent by a trailing `// order-independent`
 *   or `# order-independent` comment on the same line or the line immediately
 *   above it in the raw file text (non-standard JSON — the check scans the raw
 *   source, not the parsed value, so it can see annotation comments).
 *
 *   Exit codes:
 *   - 0 — all clean (no glob aggregators, or all are annotated order-independent)
 *   - 1 — at least one unannotated glob aggregator found
 *
 *   Usage: node scripts/fleet/check/run-s-globs-are-explicit.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, sequential gate.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

// require-regex-comment: matches `run-s`/`run-p` followed by a task prefix ending in `:*`.
const GLOB_RE = /\brun-[sp]\s+[^\s"']*:\*/

// require-regex-comment: matches `# order-independent` or `// order-independent` annotation.
const ORDER_INDEPENDENT_RE = /(?:#|\/\/)\s*order-independent/i

export interface GlobFinding {
  readonly file: string
  readonly scriptKey: string
  readonly value: string
  readonly line: number
}

/**
 * Scan the raw text of a `package.json` for unannotated glob aggregators,
 * returning one finding per affected line. Operates on raw text to detect
 * inline `# order-independent` / `// order-independent` comments that a JSON
 * parser would reject.
 */
export function scan(filePath: string, rawText: string): GlobFinding[] {
  const findings: GlobFinding[] = []
  const lines = rawText.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (!GLOB_RE.test(line)) {
      continue
    }
    // Skip when the annotation appears on this line or the immediately preceding line.
    const prevLine = i > 0 ? (lines[i - 1] ?? '') : ''
    if (
      ORDER_INDEPENDENT_RE.test(line) ||
      ORDER_INDEPENDENT_RE.test(prevLine)
    ) {
      continue
    }
    // Extract the script key and value for the diagnostic.
    // Matches `  "key": "run-s prefix:*"` in standard package.json formatting.
    const keyMatch = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(line)
    const scriptKey = keyMatch?.[1] ?? '<unknown>'
    const value = keyMatch?.[2] ?? line.trim()
    findings.push({ file: filePath, scriptKey, value, line: i + 1 })
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')

  const lsResult = spawnSync(
    'git',
    ['ls-files', '--', '*/package.json', 'package.json'],
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
          .filter(f => f.length > 0)
          .map(f => path.join(REPO_ROOT, f))
      : []

  const allFindings: GlobFinding[] = []

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // Skip files with no scripts block — nothing to check.
    if (!raw.includes('"scripts"')) {
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
        '[run-s-globs-are-explicit] all clean — no unannotated glob aggregators.\n',
      )
    }
    process.exit(0)
  }

  process.stderr.write(
    `[run-s-globs-are-explicit] ${allFindings.length} unannotated \`run-s\`/\`run-p\` glob aggregator${allFindings.length === 1 ? '' : 's'} found:\n`,
  )
  for (let i = 0; i < allFindings.length; i += 1) {
    const f = allFindings[i]!
    const rel = path.relative(REPO_ROOT, f.file)
    process.stderr.write(`  ${rel}:${f.line}  "${f.scriptKey}": "${f.value}"\n`)
  }
  process.stderr.write(
    '\nnpm-run-all2 resolves `:*` globs in package.json SOURCE ORDER (ECMA-262 §10.1.11),\n' +
      'not alphabetical. An order-dependent aggregator breaks silently on reorder/insert.\n\n' +
      'Fix: list tasks explicitly for order-dependent aggregators:\n' +
      '  "gen": "run-s gen:logo gen:socket-icon gen:showcase"\n' +
      // oxlint-disable-next-line socket/no-glob-in-ordered-run-s -- example string in this check's own error message.
      '  not: "gen": "run-s gen:*"\n\n' +
      'If the aggregator is provably order-independent, annotate the line:\n' +
      // oxlint-disable-next-line socket/no-glob-in-ordered-run-s -- example string in this check's own error message.
      '  "test:all": "run-s test:*",  // order-independent\n\n' +
      'Reference: docs/agents.md/fleet/npm-run-all-ordering.md\n',
  )
  process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
