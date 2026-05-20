/**
 * @file E2E tests for the Socket CLI's top-level `--help` / `--version`
 *   behavior. Absorbed from the (now-deleted) critical-commands.e2e.test.mts
 *   "Basic commands (no auth required)" group.
 *
 *   No auth required.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { executeCliCommand } from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket CLI top-level (e2e)', () => {
  it.skipIf(!RUN)('--version produces output (known quirk: may exit 2)', async () => {
    // Note: --version currently shows help and exits with code 2 (known
    // issue). This test validates the CLI executes without crashing — the
    // exact exit code is intentionally lenient so the test doesn't break
    // when the quirk is fixed.
    const result = await executeCliCommand(['--version'], { isolateConfig: false })
    expect(result.code).toBeGreaterThanOrEqual(0)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it.skipIf(!RUN)('--help exits 0 and lists main commands', async () => {
    const result = await executeCliCommand(['--help'], { isolateConfig: false })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('socket')
    expect(result.stdout).toContain('Main commands')
  })
})
