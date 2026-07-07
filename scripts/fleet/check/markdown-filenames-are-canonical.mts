#!/usr/bin/env node
/**
 * @file `check --all` gate: every tracked Markdown file has a canonical
 *   filename — lowercase-with-hyphens, or a SCREAMING_CASE name from the
 *   allowlist (README, CHANGELOG, …) only at the repo root / docs/ / .claude/.
 *   Commit-time twin of the edit-time markdown-filename-guard hook: the guard
 *   blocks a bad NEW filename at Bash time; this catches one already committed
 *   (or introduced off the Claude path). REUSES the guard's
 *   classifyMarkdownPath predicate (imported directly — runHook is
 *   entrypoint-guarded, so importing the hook is a no-op) so the two can never
 *   drift. Exit 1 on any violation.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { classifyMarkdownPath } from '../../../.claude/hooks/fleet/markdown-filename-guard/index.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface MarkdownViolation {
  file: string
  message: string
}

// Pure: classify each relative markdown path against the canonical-name rule.
// rootDir is joined in so classifyMarkdownPath sees the absolute path it expects
// (it inspects the path string only — no filesystem access).
export function findViolations(
  relPaths: readonly string[],
  rootDir: string,
): MarkdownViolation[] {
  const violations: MarkdownViolation[] = []
  for (const rel of relPaths) {
    const verdict = classifyMarkdownPath(path.join(rootDir, rel))
    if (!verdict.ok) {
      violations.push({
        file: rel,
        message: verdict.message ?? 'non-canonical markdown filename',
      })
    }
  }
  return violations
}

export function trackedMarkdownFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '*.md', '*.markdown', '*.MD'], {
    cwd: rootDir,
    stdio: 'pipe',
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function main(): Promise<void> {
  const violations = findViolations(trackedMarkdownFiles(REPO_ROOT), REPO_ROOT)
  if (violations.length === 0) {
    logger.success('All markdown filenames are canonical')
    return
  }
  logger.fail('Non-canonical markdown filename(s)')
  logger.log('')
  for (const violation of violations) {
    logger.log(`  ${violation.file}`)
    logger.log(`    ${violation.message}`)
  }
  process.exitCode = 1
}

// Entrypoint-guarded so the test can import findViolations without triggering
// the git scan (the check runs as a standalone `node` entrypoint via check.mts).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    logger.fail('markdown-filenames check failed:', error)
    process.exitCode = 1
  })
}
