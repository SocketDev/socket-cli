/**
 * @file E2E tests for `socket audit-log`, `socket fix`, and `socket ci`.
 *   Ported from the corresponding sections of `packages/cli/test/smoke.sh`.
 *
 *   These commands share a shape (help / dry-run / no-args run); audit-log
 *   needs auth, fix and ci are local-only.
 *
 *   Gated on `RUN_E2E_TESTS=1`.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import {
  executeCliCommand,
  executeCliInScratch,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket audit-log (e2e, auth required)', () => {
  it.skipIf(!RUN)('audit-log --help exits 0', async () => {
    const result = await executeCliCommand(['audit-log', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('audit-log --dry-run exits 0', async () => {
    const result = await executeCliCommand(['audit-log', '--dry-run'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('audit-log exits 0', async () => {
    const result = await executeCliInScratch(['audit-log'])
    expect(result.code).toBe(0)
  })
})

describe('socket fix (e2e)', () => {
  it.skipIf(!RUN)('fix --help exits 0', async () => {
    const result = await executeCliCommand(['fix', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('fix --dry-run exits 0', async () => {
    const result = await executeCliCommand(['fix', '--dry-run'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('fix exits 0', async () => {
    // Scratch-isolated with a minimal package.json so `fix` has something
    // to operate on without touching the developer's repo.
    const result = await executeCliInScratch(['fix'], {
      seedFiles: {
        'package.json': JSON.stringify({ name: 'socket-cli-e2e-fix', version: '0.0.0' }),
      },
    })
    expect(result.code).toBe(0)
  })
})

describe('socket ci (e2e)', () => {
  it.skipIf(!RUN)('ci --help exits 0', async () => {
    const result = await executeCliCommand(['ci', '--help'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('ci --dry-run exits 0', async () => {
    const result = await executeCliCommand(['ci', '--dry-run'])
    expect(result.code).toBe(0)
  })

  it.skipIf(!RUN)('ci exits 0', async () => {
    const result = await executeCliInScratch(['ci'], {
      seedFiles: {
        'package.json': JSON.stringify({ name: 'socket-cli-e2e-ci', version: '0.0.0' }),
      },
    })
    expect(result.code).toBe(0)
  })
})
