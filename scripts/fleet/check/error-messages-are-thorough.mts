// Fleet check — error messages are thorough (no vague-only throws).
//
// Commit-time complement to the `error-message-quality-nudge` Stop hook. The
// reminder grades the error-message strings in code BLOCKS the assistant wrote
// this turn; this check grades the same shape across the COMMITTED source tree,
// so a vague message that slipped in before the hook existed (or in a turn the
// hook didn't see) still gets swept. Same edit-nudge + commit-check twin
// pattern as no-env-kill-switch-guard / env-kill-switches-are-absent.
//
// The fleet rule (CLAUDE.md "Error messages"): an error message is UI — the
// reader should fix the problem from the message alone (what / where / saw vs.
// wanted / fix). A bare `throw new Error("invalid")` fails on all four.
//
// Detection + grading are SHARED with the reminder via
// `.claude/hooks/fleet/_shared/error-message-quality.mts` (ERROR_CLASS_RE +
// gradeMessage) and `_shared/acorn` (findThrowNew), so the two surfaces never
// drift. AST-based: `findThrowNew` walks every `throw new <Ctor>(…)`, then the
// static-string first arg runs through `gradeMessage`. Template literals with
// interpolation, identifiers, and any message carrying a colon / quoted value /
// length > 40 clear the bar (presumed specific).
//
// Scope: the repo's own source trees (src / scripts / packages), skipping
// build output, vendored trees, node_modules, tests + fixtures, and the
// `.claude/` hook tree (the reminder + the guard fixtures legitimately name the
// vague phrases). Reporting-only candidates the human rewrites; never auto-fixed
// (the right specific message needs judgment).
//
// Usage: node scripts/fleet/check/error-messages-are-thorough.mts [--quiet]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { findThrowNew } from '../../../.claude/hooks/fleet/_shared/acorn/index.mts'
import {
  ERROR_CLASS_RE,
  gradeMessage,
} from '../../../.claude/hooks/fleet/_shared/error-message-quality.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Top-level source trees to scan, when present. Others (test/, docs/, the
// `.claude/` hook tree) are intentionally out of scope.
const SCAN_ROOTS = ['src', 'scripts', 'packages']

// Directories never worth walking: build output, vendored trees, deps, and the
// test/fixtures corpora (fixture files legitimately carry bad messages).
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'out',
  'pkg-node',
  'pkg-node-dev',
  'target',
  'upstream',
  'vendor',
])

const SCAN_EXTENSIONS = ['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts']

// Path fragments (normalized to `/`) whose files are exempt: they legitimately
// author the vague phrases (the shared classifier + the reminder that consumes
// it), and test files (fixtures of bad messages).
const SELF_EXEMPT_FRAGMENTS = [
  '_shared/error-message-quality',
  'error-message-quality-nudge/',
  'check/error-messages-are-thorough',
]

export interface VagueThrow {
  readonly file: string
  readonly line: number
  readonly errorClass: string
  readonly message: string
  readonly label: string
  readonly hint: string
}

export function isExempt(relFile: string): boolean {
  const normalized = normalizePath(relFile)
  if (normalized.endsWith('.test.mts') || normalized.endsWith('.test.ts')) {
    return true
  }
  for (let i = 0, { length } = SELF_EXEMPT_FRAGMENTS; i < length; i += 1) {
    if (normalized.includes(SELF_EXEMPT_FRAGMENTS[i]!)) {
      return true
    }
  }
  return false
}

function isScannable(filePath: string): boolean {
  const ext = path.extname(filePath)
  return SCAN_EXTENSIONS.includes(ext)
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name.startsWith('.') || SKIP_DIRS.has(name)) {
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
      out.push(...collectSourceFiles(abs))
    } else if (isScannable(abs)) {
      out.push(abs)
    }
  }
  return out
}

export function scanFile(relFile: string, text: string): VagueThrow[] {
  const hits: VagueThrow[] = []
  const sites = findThrowNew(text, ERROR_CLASS_RE)
  for (let i = 0, { length } = sites; i < length; i += 1) {
    const site = sites[i]!
    const message = (site.message ?? '').trim()
    const grade = gradeMessage(message)
    if (grade) {
      hits.push({
        file: relFile,
        line: site.line,
        errorClass: site.ctorName,
        message,
        label: grade.label,
        hint: grade.hint,
      })
    }
  }
  return hits
}

export function scanRepo(repoRoot: string): VagueThrow[] {
  const hits: VagueThrow[] = []
  for (let i = 0, { length } = SCAN_ROOTS; i < length; i += 1) {
    const root = path.join(repoRoot, SCAN_ROOTS[i]!)
    for (const abs of collectSourceFiles(root)) {
      const relFile = path.relative(repoRoot, abs)
      if (isExempt(relFile)) {
        continue
      }
      let text: string
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      hits.push(...scanFile(relFile, text))
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanRepo(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-error-messages-are-thorough] vague-only error messages (state what / where / saw-vs-wanted / fix):',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(
        `  ✗ ${h.file}:${h.line} — throw new ${h.errorClass}("${h.message}")`,
      )
      logger.error(`      ${h.label}: ${h.hint}`)
    }
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-error-messages-are-thorough] no vague-only error messages.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
