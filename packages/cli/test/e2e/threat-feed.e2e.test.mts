/**
 * @file E2E tests for `socket threat-feed`. Ported from
 *   `packages/cli/test/smoke.sh`'s threat-feed section (6 commands).
 *
 *   threat-feed is interactive by default; smoke.sh notes a "potential
 *   caching issue" on the first run. The non-interactive forms drive the
 *   tests here.
 *
 *   Gated on `RUN_E2E_TESTS=1`. Auth required.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import {
  executeCliCommand,
  validateSocketJsonContract,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket threat-feed (e2e, auth required)', () => {
  it.skipIf(!RUN)('threat-feed --help exits 0', async () => {
    const result = await executeCliCommand(['threat-feed', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('threat-feed --dry-run exits 0', async () => {
    const result = await executeCliCommand(['threat-feed', '--dry-run'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('threat-feed (interactive default) exits 0', async () => {
    const result = await executeCliCommand(['threat-feed'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('threat-feed --no-interactive exits 0', async () => {
    const result = await executeCliCommand(['threat-feed', '--no-interactive'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('threat-feed --json conforms to contract', async () => {
    const result = await executeCliCommand(['threat-feed', '--json'])
    expect(result.code).toBe(0)
    validateSocketJsonContract(result.stdout, 0)
  })

  it.skipIf(!RUN)('threat-feed --markdown exits 0', async () => {
    const result = await executeCliCommand(['threat-feed', '--markdown'])
    expect(result.code).toBe(0)
  })
})
