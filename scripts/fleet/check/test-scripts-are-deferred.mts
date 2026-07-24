#!/usr/bin/env node
/*
 * @file Fleet-wide check: every `package.json` `test`/`test:*` script defers to
 *   a `.mts` wrapper (`node <path>.mts`) instead of invoking a test runner
 *   binary directly. Src/repo-tier packages route through the fleet-canonical
 *   `scripts/fleet/test.mts` (its double-star-anchored vitest `include`
 *   already reaches a monorepo's nested package test/ trees from the repo
 *   root — no per-package script needed there); a raw `vitest`, `jest`,
 *   `mocha`, `ava`,
 *   or `tap` (or a bare `node --test` outside the hook/lint-rule tier) in a
 *   test* script value bypasses the wrapper's scope detection, `--config`
 *   resolution, and single-worker pre-commit setting.
 *
 *   The hook / lint-rule / git-hook tier (`.claude/hooks/**`,
 *   `.config/fleet/oxlint-plugin/**`, `.git-hooks/**`) is EXEMPT: its
 *   canonical form IS `node --test test/*.test.mts` (CLAUDE.md "Two test
 *   runners by tier"), sanctioned by prefer-vitest-guard + test-layout.md, not
 *   a violation of this rule.
 *
 *   Report-only by default (warn + exit 0) so the fleet backlog (raw `vitest`/
 *   `jest`/etc. invocations that predate this gate) can clear before the
 *   convention is enforced; `--strict` fails on any violation. Pure
 *   classification (classifyTestScript) is exported for unit tests; the
 *   scan/report is the thin CLI shell. Same rollout shape as
 *   tests-are-mirror-named.mts.
 *
 *   Usage: node scripts/fleet/check/test-scripts-are-deferred.mts [--strict] [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'

const logger = getDefaultLogger()

// `test` or `test:<anything>` — the fleet's test-script key surface.
// require-regex-comment: matches a package.json scripts key named `test` or `test:<suffix>`.
const TEST_SCRIPT_KEY_RE = /^test(?::.+)?$/

// A compliant value: `node <path>.mts` (optionally followed by more args).
// The wrapper OWNS the runner call; what it does internally is out of scope.
// require-regex-comment: matches `node <path ending in .mts>` at the start of a script value.
const MTS_WRAPPER_RE = /^node\s+\S+\.mts\b/

// A raw test-runner binary invoked directly: vitest/jest/mocha/ava/tap as a
// bare word, or the Node built-in runner's `--test` flag anywhere in a `node`
// invocation.
// require-regex-comment: matches a bare vitest/jest/mocha/ava/tap runner token, or `node ... --test`.
const RAW_RUNNER_RE =
  /\b(?:ava|jest|mocha|tap|vitest)\b|\bnode\b[^&|;]*--test\b/

// The hook / lint-rule / git-hook tier's canonical runner IS `node --test`
// (CLAUDE.md "Two test runners by tier"); this gate never applies there.
export function isNodeTestTierPath(repoRelativePath: string): boolean {
  const p = normalizePath(repoRelativePath)
  return (
    /(?:^|\/)\.claude\/hooks\//.test(p) ||
    /(?:^|\/)\.config\/fleet\/oxlint-plugin\//.test(p) ||
    /(?:^|\/)\.git-hooks\//.test(p)
  )
}

export type TestScriptClassification = 'compliant' | 'exempt' | 'raw-runner'

/**
 * Classify one `test*` script value against the defer-to-`.mts` convention.
 * Pure over (repoRelativePackageJsonPath, scriptValue) so it is unit-tested
 * without a filesystem.
 */
export function classifyTestScript(
  repoRelativePackageJsonPath: string,
  scriptValue: string,
): TestScriptClassification {
  if (isNodeTestTierPath(repoRelativePackageJsonPath)) {
    return 'exempt'
  }
  const value = scriptValue.trim()
  if (!value || MTS_WRAPPER_RE.test(value)) {
    return 'compliant'
  }
  if (RAW_RUNNER_RE.test(value)) {
    return 'raw-runner'
  }
  return 'compliant'
}

export interface TestScriptFinding {
  readonly file: string
  readonly scriptKey: string
  readonly value: string
}

export async function scanRepo(repoRoot: string): Promise<TestScriptFinding[]> {
  const manifests = await collectTrackedFiles(['**/package.json'], {
    cwd: repoRoot,
  })
  const findings: TestScriptFinding[] = []
  for (const rel of manifests) {
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let manifest: { scripts?: Record<string, unknown> | undefined }
    try {
      manifest = JSON.parse(readFileSync(abs, 'utf8')) as {
        scripts?: Record<string, unknown> | undefined
      }
    } catch {
      continue
    }
    const scripts = manifest.scripts
    if (!scripts || typeof scripts !== 'object') {
      continue
    }
    for (const [scriptKey, rawValue] of Object.entries(scripts)) {
      if (!TEST_SCRIPT_KEY_RE.test(scriptKey) || typeof rawValue !== 'string') {
        continue
      }
      const classification = classifyTestScript(rel, rawValue)
      if (classification === 'raw-runner') {
        findings.push({ file: rel, scriptKey, value: rawValue })
      }
    }
  }
  return findings
}

async function main(): Promise<number> {
  const strict = process.argv.includes('--strict')
  const quiet = process.argv.includes('--quiet')
  const findings = await scanRepo(REPO_ROOT)
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        '[test-scripts-are-deferred] every test* package.json script defers to a .mts wrapper.',
      )
    }
    return 0
  }
  const report = strict ? logger.fail.bind(logger) : logger.warn.bind(logger)
  report(
    `[test-scripts-are-deferred] ${findings.length} test* script(s) invoke a raw runner directly instead of a .mts wrapper:`,
  )
  logger.group()
  for (const f of findings) {
    report(`${f.file}  "${f.scriptKey}": "${f.value}"`)
  }
  logger.groupEnd()
  logger.log(
    'Fix: route through the fleet-canonical wrapper — `node scripts/fleet/test.mts` from the ' +
      "root (its vitest `include` already reaches a monorepo package's test/ tree), or an " +
      'equivalent thin `.mts` wrapper for a package that needs its own vitest config/env. ' +
      'See docs/agents.md/fleet/test-scripts-defer-to-mts.md.',
  )
  if (strict) {
    process.exitCode = 1
    return 1
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  void main()
}
