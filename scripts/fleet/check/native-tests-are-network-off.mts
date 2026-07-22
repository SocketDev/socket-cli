#!/usr/bin/env node
/*
 * @file Fleet-wide check: a workflow that RUNS native unit tests
 *   (`cargo test` / `cargo nextest run`, `go test`, `ctest`) must gate the run
 *   through the `run-offline` composite action — the compiled-language
 *   equivalent of the JS/TS `nock.disableNetConnect()` gate. A test run left on
 *   the bare network is flaky, slow, non-deterministic, and a data-exfil
 *   surface; `run-offline` wraps the step in a loopback-only net namespace so an
 *   unmocked outbound call has no route and fails. See CLAUDE.md
 *   "no-live-network-in-tests" and docs/agents.md/fleet/no-live-network-in-tests.md.
 *
 *   File-level gate (no YAML parser dep): a workflow that contains a native
 *   test-run invocation must also reference `run-offline`. Per-step wrapping is
 *   the doctrine's job; this catches a repo that skips the pattern entirely. A
 *   `--no-run` invocation (build only, no runtime network) and comment lines are
 *   ignored. js/ts is covered separately by the runtime `nock` setup + the
 *   `no-unmocked-net-guard` hook, so this check is native-only.
 *
 *   Disabled seam: reports (exit 0) until every native member wraps its test
 *   steps (#68 Phase 2). Flip ENFORCING to true to make a gap fail the gate.
 *
 *   Exit codes:
 *   - 0 — no native test workflow, every one references run-offline, or a gap
 *     exists while ENFORCING is off
 *   - 1 — a native test workflow skips run-offline AND ENFORCING is on
 *
 *   Usage: node scripts/fleet/check/native-tests-are-network-off.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Report-only until every native member (envrypt/decmpfs/abitious) wraps its
// test steps in run-offline (#68 Phase 2); then flip to true so a new native
// repo cannot land an ungated test workflow.
const ENFORCING = false

// A native test-RUN invocation. `--no-run` (build only) is excluded by the
// caller — it never runs a test binary, so it needs no network gate.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const NATIVE_TEST_RE = /\b(?:cargo\s+(?:test|nextest\s+run)|go\s+test|ctest)\b/

// The run-offline gate — the composite action, its ./ uses ref, or the wrapper
// script name. Any of these in the file marks the offline pattern as adopted.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const OFFLINE_REF_RE = /run-offline/

export interface NativeTestGap {
  file: string
  sample: string
}

/**
 * A workflow line runs native tests when it matches NATIVE_TEST_RE, is not a
 * YAML comment, and is not a build-only `--no-run` invocation.
 */
export function lineRunsNativeTests(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.startsWith('#')) {
    return false
  }
  if (trimmed.includes('--no-run')) {
    return false
  }
  return NATIVE_TEST_RE.test(trimmed)
}

/**
 * Return the workflows under a `.github/workflows/` directory that run native
 * tests without any run-offline reference. A missing directory returns [] (a
 * repo with no workflows passes). Only `.yml` / `.yaml` files are scanned.
 */
export function findNativeTestGaps(workflowsDir: string): NativeTestGap[] {
  if (!existsSync(workflowsDir)) {
    return []
  }
  const gaps: NativeTestGap[] = []
  const entries = readdirSync(workflowsDir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isFile()) {
      continue
    }
    if (!/\.ya?ml$/.test(entry.name)) {
      continue
    }
    const content = readFileSync(path.join(workflowsDir, entry.name), 'utf8')
    if (OFFLINE_REF_RE.test(content)) {
      continue
    }
    const lines = content.split('\n')
    const hit = lines.find(lineRunsNativeTests)
    if (hit) {
      gaps.push({ file: entry.name, sample: hit.trim() })
    }
  }
  return gaps.toSorted((a, b) => a.file.localeCompare(b.file))
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const workflowsDir = path.join(REPO_ROOT, '.github', 'workflows')
  const gaps = findNativeTestGaps(workflowsDir)
  if (gaps.length === 0) {
    if (!quiet) {
      logger.success(
        'native test workflows gate their run through run-offline.',
      )
    }
    return
  }
  const label = ENFORCING ? logger.fail : logger.warn
  label.call(
    logger,
    `${gaps.length} native test workflow(s) run tests without the run-offline gate:`,
  )
  for (let i = 0, { length } = gaps; i < length; i += 1) {
    const gap = gaps[i]!
    logger.error(`  .github/workflows/${gap.file} — ${gap.sample}`)
  }
  logger.error(
    '  Wrap the test-run step in the run-offline action so an unmocked ' +
      'outbound call fails: pre-fetch deps online, then',
  )
  logger.error('    - uses: ./.github/actions/fleet/run-offline')
  logger.error(
    '      with: { run: cargo test --workspace --all-features --offline }',
  )
  logger.error('  See docs/agents.md/fleet/no-live-network-in-tests.md.')
  if (ENFORCING) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
