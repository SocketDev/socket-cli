// Fleet check — rule citations are generic, not dated incident logs.
//
// Commit-time complement to the `dated-citation-reminder` PreToolUse hook. The
// reminder nudges when an edit ADDS a dated citation this turn; this check
// sweeps the same shape across the COMMITTED prose tree, so a dated citation
// that slipped in before the hook existed (or in a turn it didn't see) still
// gets caught. Same edit-reminder + commit-check twin pattern as
// error-message-quality-reminder / error-messages-are-thorough.
//
// The fleet rule (CLAUDE.md "Compound lessons into rules"): when a rule / hook
// / SKILL / doc cites the case that motivated it, write it GENERICALLY, framed
// as an example — NOT as a dated incident log. Dates, version deltas,
// percentages, and commit SHAs age into a changelog and leak detail; the
// example shape is timeless.
//
// Detection is SHARED with the reminder via
// `.claude/hooks/fleet/_shared/dated-citation.mts` (findDatedCitations +
// isRuleProseSurface), so the two surfaces never drift. Only RATIONALE lines
// (carrying `**Why:**` / "incident" / "regression" / "red-lined") that ALSO
// carry a specificity token are flagged — a bare date in a SHA-pin comment,
// soak annotation, .gitmodules stamp, or CHANGELOG entry is left alone.
//
// Scope: the fleet-facing rule-prose surfaces — CLAUDE.md, docs/agents.md/fleet,
// .claude/skills/**/SKILL.md, .claude/hooks/fleet/**/README.md. Reporting-only;
// never auto-fixed (rewriting to the generic form needs judgment).
//
// Usage: node scripts/fleet/check/rule-citations-are-generic.mts [--quiet]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  findDatedCitations,
  isRuleProseSurface,
} from '../../../.claude/hooks/fleet/_shared/dated-citation.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Directories never worth walking for rule prose: build output, vendored
// trees, deps, git internals.
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'pkg-node',
  'pkg-node-dev',
  'target',
  'upstream',
  'vendor',
])

// This check + the shared matcher legitimately quote dated-citation examples
// in their own prose; exempt them so the gate doesn't fire on itself.
const SELF_EXEMPT_FRAGMENTS = [
  '_shared/dated-citation',
  'dated-citation-reminder/',
  'check/rule-citations-are-generic',
]

export interface DatedCitationFinding {
  readonly file: string
  readonly line: number
  readonly label: string
  readonly text: string
}

export function isExempt(relFile: string): boolean {
  const normalized = relFile.replace(/\\/g, '/')
  for (let i = 0, { length } = SELF_EXEMPT_FRAGMENTS; i < length; i += 1) {
    if (normalized.includes(SELF_EXEMPT_FRAGMENTS[i]!)) {
      return true
    }
  }
  return false
}

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (SKIP_DIRS.has(name)) {
      continue
    }
    const abs = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...collectMarkdownFiles(abs))
    } else if (name.endsWith('.md')) {
      out.push(abs)
    }
  }
  return out
}

export function scanRepo(repoRoot: string): DatedCitationFinding[] {
  const findings: DatedCitationFinding[] = []
  for (const abs of collectMarkdownFiles(repoRoot)) {
    const relFile = path.relative(repoRoot, abs)
    if (!isRuleProseSurface(relFile) || isExempt(relFile)) {
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const hits = findDatedCitations(text)
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const hit = hits[i]!
      findings.push({
        file: relFile,
        line: hit.line,
        label: hit.label,
        text: hit.text,
      })
    }
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const findings = scanRepo(REPO_ROOT)
  if (findings.length) {
    logger.fail(
      '[check-rule-citations-are-generic] dated-incident citations in rule prose — rewrite generically, as a timeless example (drop dates / version deltas / percentages / SHAs):',
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      logger.error(`  ✗ ${f.file}:${f.line} — ${f.label}`)
      logger.error(`      ${f.text}`)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-rule-citations-are-generic] all rule citations are generic.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
