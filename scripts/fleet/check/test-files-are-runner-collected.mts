#!/usr/bin/env node
/*
 * @file Fails when a repo's declared test/coverage command and its test files
 *   never meet. Three ways that happens, all of them exit 0 today:
 *
 *   1. BARREN COMMAND — the command drives a runner whose include globs match no
 *      file on disk. `pnpm run cover` then prints `Code Coverage: 0.00%` and
 *      exits 0 (bun-security-scanner: the cover leg drives vitest while every
 *      suite is written for `bun test`).
 *   2. ORPHAN FILE — a test file on disk that NO declared command collects. It is
 *      committed, reviewed, and never executed by anything.
 *   3. GATE-DARK FILE — a file only an opt-in lane script reaches, never the
 *      `test` / `cover` gate that pre-push and CI run (skills: seven
 *      `tests/tier1-structural/` suites the gate's include globs, anchored at
 *      `**\/test/**`, do not reach). Resolution is STATIC — package.json names
 *      the runner, the vitest config module supplies the globs, fast-glob
 *      answers which files match — so this costs one config import per distinct
 *      config rather than a runner spawn. What it cannot see: a positional path
 *      filter (`vitest run tier1/`) narrows a command at runtime; this models
 *      the config's full set, which only ever makes the gate MORE permissive,
 *      never falsely red. It also cannot see a suite skipped at runtime
 *      (`describe.skip`, an env guard inside the file) — collection is not
 *      execution. Sibling gate `test-files-are-vitest-run` covers the
 *      collected-but-registers-nothing half. Multi-runner repos are legal: the
 *      assertion is per COMMAND, so a repo whose `test` is `bun test` over
 *      `bun:test` suites passes. Only a command whose runner disagrees with its
 *      own files fails.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import {
  detectTestFileRunner,
  listRepoTestFiles,
  readDeclaredTestCommands,
  resolveCommandCollection,
  RUNNER_LABELS,
} from '../_shared/test-collection.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type {
  RunnerCollection,
  TestCommand,
} from '../_shared/test-collection.mts'

const logger = getDefaultLogger()

/**
 * Opt-out for a suite that is deliberately outside the gate — a live-API tier,
 * an e2e lane that needs a token or a built binary. The marker states the
 * choice in the file so a reader sees why `pnpm test` never runs it.
 */
export const OPT_IN_LANE_MARKER = 'runner-collection: opt-in lane'

export type FindingKind = 'barren-command' | 'gate-dark-file' | 'orphan-file'

export interface CollectionFinding {
  detail: string
  kind: FindingKind
  subject: string
}

/**
 * A command is barren when nothing it collects registers with the runner it
 * drives. An empty collected set is the plain case; a non-empty set whose
 * files all register through a DIFFERENT runner is the same zero wearing a
 * disguise — which is why the coverage number reads 0.00% rather than erroring.
 */
export function findBarrenCommand(
  command: TestCommand,
  collection: RunnerCollection,
  runnerByFile: ReadonlyMap<string, string | undefined>,
): CollectionFinding | undefined {
  if (!collection.collected.length) {
    return {
      detail:
        `drives ${RUNNER_LABELS[command.runner]} over include ` +
        `${JSON.stringify(collection.include)}${
          collection.base === '.' ? '' : ` (rooted at ${collection.base})`
        }, which matches no file on disk`,
      kind: 'barren-command',
      subject: command.script,
    }
  }
  let registering = 0
  for (const file of collection.collected) {
    const runner = runnerByFile.get(file)
    // A file with no detectable registration import (vitest `globals` mode, a
    // shared helper) is counted as able to register — absence of evidence
    // never fails this gate.
    if (runner === undefined || runner === command.runner) {
      registering += 1
    }
  }
  if (registering === 0) {
    const seen = new Set<string>()
    for (const file of collection.collected) {
      const runner = runnerByFile.get(file)
      if (runner) {
        seen.add(RUNNER_LABELS[runner as keyof typeof RUNNER_LABELS] ?? runner)
      }
    }
    return {
      detail:
        `drives ${RUNNER_LABELS[command.runner]} and collects ` +
        `${collection.collected.length} file(s), none of which register with ` +
        `it (they import ${[...seen].toSorted().join(', ')})`,
      kind: 'barren-command',
      subject: command.script,
    }
  }
  return undefined
}

/**
 * Files no declared command collects, and files only a non-gate one reaches.
 */
export function findUnreachedFiles(
  testFiles: readonly string[],
  allCollected: ReadonlySet<string>,
  gateCollected: ReadonlySet<string>,
  optedOut: ReadonlySet<string>,
): CollectionFinding[] {
  const findings: CollectionFinding[] = []
  for (const file of testFiles) {
    if (optedOut.has(file)) {
      continue
    }
    if (!allCollected.has(file)) {
      findings.push({
        detail: 'no declared test or coverage script collects this file',
        kind: 'orphan-file',
        subject: file,
      })
      continue
    }
    if (!gateCollected.has(file)) {
      findings.push({
        detail:
          'only an opt-in lane script collects this file; the `test` / ' +
          '`cover` gate does not',
        kind: 'gate-dark-file',
        subject: file,
      })
    }
  }
  return findings
}

/**
 * Order findings so the command-level cause reads before its file symptoms.
 */
export function sortCollectionFindings(
  findings: readonly CollectionFinding[],
): CollectionFinding[] {
  const rank: Record<FindingKind, number> = {
    'barren-command': 0,
    'orphan-file': 1,
    'gate-dark-file': 2,
  }
  return [...findings].toSorted(
    (a, b) => rank[a.kind] - rank[b.kind] || a.subject.localeCompare(b.subject),
  )
}

export async function main(): Promise<void> {
  const root = REPO_ROOT
  const commands = readDeclaredTestCommands(root)
  const testFiles = listRepoTestFiles(root)
  if (!commands.length) {
    // A repo with tests but no runnable script is itself the defect; a repo
    // with neither is scaffolding-only and passes vacuously.
    if (testFiles.length) {
      logger.fail(
        `[test-files-are-runner-collected] ${testFiles.length} test file(s) ` +
          `exist but package.json declares no test or coverage script that ` +
          `drives a known runner.\n` +
          `  Where: package.json "scripts"\n` +
          `  Saw: no \`test\` / \`cover\` script resolving to vitest, bun ` +
          `test, node --test, or jest.\n` +
          `  Wanted: a script that runs the suites on disk.\n` +
          `  Fix: add \`"test": "node scripts/fleet/test.mts"\`, or delete the ` +
          `test files nothing runs.\n`,
      )
      process.exit(1)
    }
    logger.log(
      '[test-files-are-runner-collected] no test files and no test script.',
    )
    process.exit(0)
  }
  const runnerByFile = new Map<string, string | undefined>()
  const optedOut = new Set<string>()
  for (const file of testFiles) {
    const text = readFileSync(path.join(root, file), 'utf8')
    runnerByFile.set(file, detectTestFileRunner(text))
    if (text.includes(OPT_IN_LANE_MARKER)) {
      optedOut.add(file)
    }
  }
  const allCollected = new Set<string>()
  const gateCollected = new Set<string>()
  const findings: CollectionFinding[] = []
  for (const command of commands) {
    // Sequential by design: a config that fails to resolve names the first
    // offending script rather than an arbitrary one from a parallel race.
    const collection = await resolveCommandCollection(root, command)
    for (const file of collection.collected) {
      // Files the runner picks up but that this gate does not treat as tests
      // (a fixture corpus, a template source) stay out of the reachability
      // ledger so they cannot mask an orphan.
      if (!runnerByFile.has(file)) {
        continue
      }
      allCollected.add(file)
      if (command.isGate) {
        gateCollected.add(file)
      }
    }
    const barren = findBarrenCommand(command, collection, runnerByFile)
    if (barren) {
      findings.push(barren)
    }
  }
  findings.push(
    ...findUnreachedFiles(testFiles, allCollected, gateCollected, optedOut),
  )
  if (findings.length) {
    logger.fail(
      `[test-files-are-runner-collected] ${findings.length} collection ` +
        `defect(s). A command that collects nothing, and a test file no ` +
        `command collects, both exit 0 — the count simply never moves.\n`,
    )
    for (const finding of sortCollectionFindings(findings)) {
      const label =
        finding.kind === 'barren-command'
          ? `script \`${finding.subject}\``
          : finding.subject
      logger.fail(`  [${finding.kind}] ${label} — ${finding.detail}`)
    }
    logger.fail(
      `\nFix, per kind:\n` +
        `  barren-command  — point the script at the runner its files use, ` +
        `or rewrite the files for the runner the script drives.\n` +
        `  orphan-file     — add the file's tree to a test script's include ` +
        `globs, or delete the file.\n` +
        `  gate-dark-file  — widen the \`test\` / \`cover\` include globs to ` +
        `reach it. A suite that is deliberately opt-in (live API, e2e needing ` +
        `a token) marks itself: ${OPT_IN_LANE_MARKER}\n`,
    )
    process.exit(1)
  }
  logger.log(
    `[test-files-are-runner-collected] ${testFiles.length} test file(s) ` +
      `reachable from ${commands.length} declared command(s).`,
  )
  process.exit(0)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every declared test command and the repo test files actually meet',
  help: 'Usage: node scripts/fleet/check/test-files-are-runner-collected.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
