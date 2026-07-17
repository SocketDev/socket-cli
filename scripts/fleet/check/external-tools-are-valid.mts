// Fleet check — every external-tools.json / bundle-tools.json validates against
// the canonical schema.
//
// These files pin the versions + integrities of every external tool a repo
// downloads, bundles, or installs. Nothing validates their shape today, so a
// renamed field, a wrong nesting, or a typo'd version key surfaces only at
// runtime — as an undefined-at-runtime throw deep in a build or install step,
// far from the edit that caused it. (Real incident: a `tools['sfw']?.version`
// lookup against a drifted shape left an INLINED_* env var empty and hung a
// pre-commit test run.)
//
// This check parses each tool-data file with the shared TypeBox schema and
// fails `check --all` on any violation, so drift is caught at the edit instead.
//
// Scanned files (whichever exist in the repo), all the `{ tools }` shape:
//   - <root>/external-tools.json
//   - <root>/packages/* / **/bundle-tools.json
//   - .claude/hooks/**/external-tools.json
//
// Usage: node scripts/fleet/check/external-tools-are-valid.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { collectIssues, ToolsConfig } from '../lib/external-tools-schema.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface FileIssue {
  readonly file: string
  readonly path: string
  readonly message: string
}

/**
 * Find every external-tools.json / bundle-tools.json under repoRoot (skipping
 * node_modules, dist, build, and other vendored/output trees).
 */
export function findToolFiles(repoRoot: string): string[] {
  return globSync(['**/external-tools.json', '**/bundle-tools.json'], {
    cwd: repoRoot,
    // `dot: true` — the security-hook tool data lives under `.claude/hooks/**`,
    // a dot-directory `**` skips by default. Without this the check globs only
    // non-dot trees and reports green while never seeing the `.claude/**` files
    // (a false-green that let unmodeled fields drift in undetected).
    dot: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/upstream/**',
      '**/vendor/**',
    ],
  })
}

/**
 * Validate every tool-data file under repoRoot. Returns one FileIssue per
 * schema violation (empty when all files are valid). A file that is not valid
 * JSON is itself reported as an issue rather than throwing.
 */
export function scanRepo(repoRoot: string): FileIssue[] {
  const issues: FileIssue[] = []
  const files = findToolFiles(repoRoot)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const relPath = files[i]!
    const abs = path.join(repoRoot, relPath)
    if (!existsSync(abs)) {
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(abs, 'utf8'))
    } catch (e) {
      issues.push({
        file: relPath,
        path: '(file)',
        message: `not valid JSON: ${errorMessage(e)}`,
      })
      continue
    }
    const found = collectIssues(ToolsConfig, raw)
    for (let j = 0, len = found.length; j < len; j += 1) {
      const f = found[j]!
      issues.push({ file: relPath, path: f.path, message: f.message })
    }
  }
  return issues
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const issues = scanRepo(REPO_ROOT)
  if (issues.length) {
    logger.fail(
      '[check-external-tools-are-valid] tool-data files that violate the schema:',
    )
    for (let i = 0, { length } = issues; i < length; i += 1) {
      const it = issues[i]!
      logger.error(`  ✗ ${it.file} → ${it.path}: ${it.message}`)
    }
    logger.error(
      '  Each external-tools.json / bundle-tools.json must match the shared schema in scripts/fleet/lib/external-tools-schema.mts. Add the missing/renamed field to the schema if it is intentional, or fix the data file.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-external-tools-are-valid] every tool-data file matches the schema.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
