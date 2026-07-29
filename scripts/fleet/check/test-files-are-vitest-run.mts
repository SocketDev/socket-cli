#!/usr/bin/env node
/**
 * @file Fails when a test file the vitest config picks up registers through
 *   another runner's API instead of vitest's.
 *   The failure this prevents is SILENT. vitest loads such a file, finds
 *   no describe/it/test registered through its own API, and reports
 *   "no tests" — a passing run with zero coverage. Three specs written
 *   in one session were green-by-vacuum this way before anyone noticed
 *   the count had not moved.
 *   A PreToolUse hook (`vitest-vs-node-test-guard`) already catches this
 *   at Edit/Write time, but it cannot see a file created another way:
 *   the three specs above were written with a `cat > … <<EOF` heredoc
 *   through Bash, so no Edit/Write hook ran. This check judges the TREE
 *   rather than the action, so it holds no matter how a file arrived —
 *   heredoc, patch, cascade, or an editor outside the session.
 *   Scope comes from the repo's OWN resolved vitest include/exclude, not a
 *   fixed glob: a `node --test` corpus the config deliberately excludes
 *   (`scripts/**\/test/**`, a `nodeTestExclude` tree) is not a finding, and a
 *   spec in a tree the fixed glob never named still is.
 *   `bun:test` and `@jest/globals` count alongside `node:test` — a vitest
 *   command pointed at a bun suite reports 0.00% coverage and exits 0, the
 *   same silent zero from the other side.
 *   Exempt: files that legitimately import another runner as a FIXTURE for
 *   testing this very rule; they opt out with an inline marker.
 *   Sibling gate: `test-files-are-runner-collected` judges whether a command
 *   and the files meet AT ALL. This one judges what a collected file does.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import {
  detectTestFileRunner,
  readDeclaredTestCommands,
  resolveCommandCollection,
  RUNNER_LABELS,
  TestConfigResolutionError,
} from '../_shared/test-collection.mts'
import { REPO_ROOT } from '../paths.mts'

import type { RunnerId } from '../_shared/test-collection.mts'

const logger = getDefaultLogger()

// Opt-out for the rule's own fixtures: a file testing node:test detection
// must be allowed to import node:test.
export const EXEMPT_MARKER = 'vitest-runner-check: fixture'

export interface Finding {
  file: string
  runner: RunnerId
}

export function scanFile(relPath: string, text: string): Finding[] {
  if (text.includes(EXEMPT_MARKER)) {
    return []
  }
  const runner = detectTestFileRunner(text)
  // No registration import at all means vitest `globals` mode or a helper —
  // absence of evidence is not a finding.
  if (!runner || runner === 'vitest') {
    return []
  }
  return [{ file: relPath, runner }]
}

async function main(): Promise<void> {
  const root = REPO_ROOT
  const commands = readDeclaredTestCommands(root).filter(
    c => c.runner === 'vitest',
  )
  // A repo that declares no vitest command has nothing for this gate to judge;
  // the sibling gate owns "a test file no command reaches".
  if (!commands.length) {
    logger.log('[test-files-are-vitest-run] no vitest command declared.')
    process.exit(0)
  }
  const collected = new Set<string>()
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const command = commands[i]!
    // Sequential by design: configs resolve in declaration order so a failure
    // names the first offending script.
    const collection = await resolveCommandCollection(root, command)
    for (const file of collection.collected) {
      collected.add(file)
    }
  }
  const findings: Finding[] = []
  const scanned = [...collected].toSorted()
  for (let i = 0, { length } = scanned; i < length; i += 1) {
    const rel = scanned[i]!
    findings.push(...scanFile(rel, readFileSync(path.join(root, rel), 'utf8')))
  }
  if (findings.length) {
    logger.fail(
      `[test-files-are-vitest-run] ${findings.length} test file(s) register ` +
        `through another runner's API but sit where vitest collects them. ` +
        `vitest will load each, register nothing, and report "no tests" — a ` +
        `green run with zero coverage.\n`,
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const finding = findings[i]!
      logger.fail(
        `  ${finding.file} — imports ${RUNNER_LABELS[finding.runner]}`,
      )
    }
    logger.fail(
      `\nFix: import { describe, test } from 'vitest'. A suite that must stay ` +
        `on another runner belongs in a tree the vitest config excludes, with ` +
        `a script that runs it.\n` +
        `A file that must import another runner as a fixture for this rule ` +
        `marks itself with the comment: ${EXEMPT_MARKER}\n`,
    )
    process.exit(1)
  }
  logger.log(
    '[test-files-are-vitest-run] all test files use the vitest runner.',
  )
  process.exit(0)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    if (e instanceof TestConfigResolutionError) {
      logger.fail(`[test-files-are-vitest-run] ${e.message}`)
      process.exit(1)
    }
    throw e
  })
}
