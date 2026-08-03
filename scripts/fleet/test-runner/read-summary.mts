/**
 * @file Reads back the counts test-runner/run-vitest.mts wrote to
 *   `FLEET_TEST_SUMMARY_PATH` after a status-0 vitest run. Split out of
 *   test.mts (which was pushing the fleet's soft file-size cap) rather than
 *   folded into summary-decision.mts, whose header deliberately advertises
 *   "no I/O" as a fast-tests property.
 */
import { existsSync, readFileSync } from 'node:fs'

import type { TestSummaryCounts } from './summary-decision.mts'

// Returns undefined on anything unexpected (missing file, malformed JSON,
// wrong shape) — a run-vitest.mts crash on its OWN write would already have
// made vitest exit non-zero before the caller reaches this read, so this
// path is defensive-only; test.mts falls back to the pre-fix "All tests
// passed" on undefined rather than inventing a fourth outcome for a state
// that should be unreachable.
export function readTestSummaryCounts(
  summaryPath: string,
): TestSummaryCounts | undefined {
  if (!existsSync(summaryPath)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
      failed?: unknown | undefined
      // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
      passed?: unknown | undefined
      // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
      total?: unknown | undefined
    }
    if (
      typeof parsed.failed !== 'number' ||
      typeof parsed.passed !== 'number' ||
      typeof parsed.total !== 'number'
    ) {
      return undefined
    }
    return { failed: parsed.failed, passed: parsed.passed, total: parsed.total }
  } catch {
    return undefined
  }
}
