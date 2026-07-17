#!/usr/bin/env node
/*
 * @file Fleet-wide check: every slashed pattern in `.config/fleet/.prettierignore`
 *   must be `**​/`-anchored, or it silently matches nothing.
 *
 *   Why: oxfmt builds the `--ignore-path` matcher with `Gitignore::new(path)`
 *   (oxc apps/oxfmt/src/cli/resolve.rs), which roots the matcher at the ignore
 *   FILE's directory — `.config/fleet/`. Per gitignore semantics, a pattern with
 *   a leading or interior `/` is anchored to that root, so a bare
 *   `bootstrap/fleet.mts` resolves to `.config/fleet/bootstrap/fleet.mts` and
 *   never matches a repo file. Only a `**​/`-prefixed pattern (or a slashless
 *   basename / trailing-slash-only dir name) matches at any depth. A bare slashed
 *   entry is a silent no-op — the exact footgun that hid behind the `**​/`-twins
 *   already in this file. CLAUDE.md "lint-rules" / code-is-law.
 *
 *   Exempt: comments, blanks, negations are still checked (a dead `!`-re-include
 *   is also a bug); a line carrying `# anchor-ok` opts out (a pattern genuinely
 *   meant to anchor under `.config/fleet/`).
 *
 *   Exit: 0 = all slashed patterns anchored; 1 = at least one silent no-op.
 *   Usage: node scripts/fleet/check/prettierignore-globs-are-anchored.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const IGNORE_PATH = path.join('.config', 'fleet', '.prettierignore')
// A line opts out with a trailing `# anchor-ok` (a pattern deliberately anchored
// under .config/fleet/ itself, the rare legitimate case).
const OPT_OUT_RE = /#\s*anchor-ok\b/

export interface UnanchoredFinding {
  readonly line: number
  readonly pattern: string
  readonly negation: boolean
}

/**
 * A pattern is gitignore-anchored to the ignore file's root when, after
 * dropping a leading `!` and a single trailing `/`, it still contains a `/`
 * (leading or interior). Anchored patterns that do NOT start with `**​/` never
 * match a repo-relative path through this ignore file — they are silent
 * no-ops.
 */
export function findUnanchoredGlobs(content: string): UnanchoredFinding[] {
  const findings: UnanchoredFinding[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#') || OPT_OUT_RE.test(raw)) {
      continue
    }
    const negation = trimmed.startsWith('!')
    const pattern = negation ? trimmed.slice(1) : trimmed
    if (pattern.startsWith('**/')) {
      continue
    }
    // Drop a single trailing '/' (a dir marker) before testing for an
    // anchoring slash — `node_modules/` is slashless-anchored (matches any
    // depth), `a/b/` and `a/b` are root-anchored.
    const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern
    if (body.includes('/')) {
      findings.push({ line: i + 1, pattern: trimmed, negation })
    }
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const abs = path.join(REPO_ROOT, IGNORE_PATH)
  if (!existsSync(abs)) {
    // No fleet .prettierignore (a non-fleet repo) — nothing to assert.
    return
  }
  const findings = findUnanchoredGlobs(readFileSync(abs, 'utf8'))
  if (findings.length === 0) {
    if (!quiet) {
      logger.log(`${IGNORE_PATH}: all slashed patterns are **/-anchored.`)
    }
    return
  }
  logger.error(
    `${IGNORE_PATH}: ${findings.length} slashed pattern(s) that silently match nothing.`,
  )
  for (const f of findings) {
    const prefix = f.negation ? '!' : ''
    const bare = f.negation ? f.pattern.slice(1) : f.pattern
    logger.error(
      `  ${IGNORE_PATH}:${f.line}  ${f.pattern}\n` +
        `    Saw: anchored to the ignore-file dir (.config/fleet/) — matches no repo file.\n` +
        `    Fix: use ${prefix}**/${bare} to match at any depth, or drop it if a **/-twin already covers it. Add "# anchor-ok" only if it truly targets .config/fleet/.`,
    )
  }
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
