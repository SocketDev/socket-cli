/**
 * @file E2E tests for `socket login`, `socket logout`, and `socket whoami`.
 *   Ported from `packages/cli/test/smoke.sh`'s login/logout sections, plus
 *   the `whoami` check that lived in `critical-commands.e2e.test.mts`.
 *
 *   login is interactive in normal use; the smoke.sh check only ran the
 *   no-arg form (which exits 0 after printing a prompt note). logout
 *   mutates the developer's stored Socket session, so the destructive
 *   forms route through executeCliInScratch (isolated HOME →
 *   isolated keychain). The non-destructive `--help` / `--dry-run`
 *   checks use the normal helpers.
 *
 *   Gated on `RUN_E2E_TESTS=1`. The destructive logout run additionally
 *   gates on RUN_E2E_DESTRUCTIVE=1 even though scratch-isolation means it's
 *   safe — operator opt-in stays consistent with the repos.e2e file.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import {
  executeCliCommand,
  executeCliInScratch,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS
const RUN_DESTRUCTIVE = process.env['RUN_E2E_DESTRUCTIVE'] === '1'

describe('socket login (e2e)', () => {
  it.skipIf(!RUN)('login --help exits 0', async () => {
    const result = await executeCliCommand(['login', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('login --dry-run exits 0', async () => {
    const result = await executeCliCommand(['login', '--dry-run'])
    expect(result.code).toBe(0)
  })

  // smoke.sh's `run_socket 0 login` ran the real login flow. In an e2e
  // suite that can't accept TTY input, the equivalent is to confirm the
  // command starts cleanly when there's no token to bind to — easiest in
  // a scratch HOME with --no-interactive.
  it.skipIf(!RUN)('login --no-interactive (no token) exits non-zero cleanly', async () => {
    const result = await executeCliInScratch(['login', '--no-interactive'])
    expect(result.code).toBeGreaterThan(0)
  })
})

describe('socket logout (e2e)', () => {
  it.skipIf(!RUN)('logout --help exits 0', async () => {
    const result = await executeCliCommand(['logout', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('logout --dry-run exits 0', async () => {
    const result = await executeCliCommand(['logout', '--dry-run'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN || !RUN_DESTRUCTIVE)(
    'logout (scratch-isolated) exits 0',
    async () => {
      // Even though scratch isolation means we're never touching the real
      // session, gate on RUN_E2E_DESTRUCTIVE so destructive ops stay
      // explicitly opt-in across the e2e suite.
      const result = await executeCliInScratch(['logout'])
      expect(result.code).toBe(0)
    },
  )
})

describe('socket whoami (e2e, auth required)', () => {
  let hasAuth = false
  beforeAll(async () => {
    if (RUN) {
      hasAuth = !!(await getDefaultApiToken())
    }
  })

  it.skipIf(!RUN || !hasAuth)('whoami exits 0 with auth present', async () => {
    const result = await executeCliInScratch(['whoami'])
    expect(result.code).toBe(0)
  })
})
