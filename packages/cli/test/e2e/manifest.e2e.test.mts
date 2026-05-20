/**
 * @file E2E tests for the `socket manifest` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s manifest section (18 commands).
 *
 *   Covers: each generator subcommand (auto, conda, gradle, kotlin, scala) at
 *   help / dry-run / no-args invocation. No auth required — manifest
 *   generation is local.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { executeCliCommand } from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket manifest (e2e)', () => {
  describe('top-level', () => {
    it.skipIf(!RUN)('manifest (no subcommand) exits 2', async () => {
      const result = await executeCliCommand(['manifest'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('manifest --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('manifest --dry-run exits 0', async () => {
      const result = await executeCliCommand(['manifest', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('manifest auto', () => {
    it.skipIf(!RUN)('manifest auto (no path) exits 1', async () => {
      const result = await executeCliCommand(['manifest', 'auto'])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('manifest auto --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'auto', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('manifest auto --dry-run exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'auto', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('manifest conda', () => {
    it.skipIf(!RUN)('manifest conda (no env file) exits 1', async () => {
      const result = await executeCliCommand(['manifest', 'conda'])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('manifest conda --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'conda', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('manifest conda --dry-run exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'conda', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('manifest gradle', () => {
    it.skipIf(!RUN)('manifest gradle (no project) exits 1', async () => {
      const result = await executeCliCommand(['manifest', 'gradle'])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('manifest gradle --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'gradle', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)(
      'manifest gradle --dry-run exits 1 (per smoke.sh — gradle wrapper not found)',
      async () => {
        const result = await executeCliCommand(['manifest', 'gradle', '--dry-run'])
        expect(result.code).toBe(1)
      },
    )
  })

  describe('manifest kotlin', () => {
    it.skipIf(!RUN)('manifest kotlin (no project) exits 1', async () => {
      const result = await executeCliCommand(['manifest', 'kotlin'])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('manifest kotlin --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'kotlin', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('manifest kotlin --dry-run exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'kotlin', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('manifest scala', () => {
    it.skipIf(!RUN)('manifest scala (no project) exits 1', async () => {
      const result = await executeCliCommand(['manifest', 'scala'])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('manifest scala --help exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'scala', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('manifest scala --dry-run exits 0', async () => {
      const result = await executeCliCommand(['manifest', 'scala', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })
})
