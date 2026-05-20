/**
 * @file E2E tests for the `socket package` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s package section (25 commands).
 *
 *   Covers: shallow / score against representative npm packages — `socket`
 *   (the package itself, regression case for past 500s), `babel` (well-known
 *   ok package), `nope` (single-publish curio that sometimes hangs server
 *   side), and `mostdefinitelynotworkingletskeepitthatway` (silent-no-data
 *   case where the server returns nothing rather than 404).
 *
 *   Gated on `RUN_E2E_TESTS=1`. Auth-required tests additionally require a
 *   Socket API token.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import {
  executeCliCommand,
  validateSocketJsonContract,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

const SILENT_NO_DATA_PKG = 'mostdefinitelynotworkingletskeepitthatway'

describe('socket package (e2e)', () => {
  describe('help and dry-run (no auth required)', () => {
    it.skipIf(!RUN)('package (no subcommand) exits 2', async () => {
      const result = await executeCliCommand(['package'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('package --help exits 0', async () => {
      const result = await executeCliCommand(['package', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('package --dry-run exits 0', async () => {
      const result = await executeCliCommand(['package', '--dry-run'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('package score --help exits 0', async () => {
      const result = await executeCliCommand(['package', 'score', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('package score --dry-run (no args) exits 2', async () => {
      const result = await executeCliCommand(['package', 'score', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('package shallow --help exits 0', async () => {
      const result = await executeCliCommand(['package', 'shallow', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('package shallow --dry-run (no args) exits 2', async () => {
      const result = await executeCliCommand(['package', 'shallow', '--dry-run'])
      expect(result.code).toBe(2)
    })
  })

  describe('package score (auth required)', () => {
    it.skipIf(!RUN)('score npm tenko exits 0', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'tenko'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('score npm socket exits 0 (regression: server 500)', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'socket'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('score npm babel exits 0', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'babel'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('score npm nope exits 0 (server may stall)', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'nope'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('score npm <silent-no-data> exits 1', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', SILENT_NO_DATA_PKG])
      expect(result.code).toBe(1)
    })

    it.skipIf(!RUN)('score npm socket --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'socket', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('score npm babel --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'babel', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('score npm nope --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'score', 'npm', 'nope', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('score npm <silent-no-data> --json conforms to error contract', async () => {
      const result = await executeCliCommand([
        'package', 'score', 'npm', SILENT_NO_DATA_PKG, '--json',
      ])
      expect(result.code).toBe(1)
      validateSocketJsonContract(result.stdout, 1)
    })
  })

  describe('package shallow (auth required)', () => {
    it.skipIf(!RUN)('shallow npm socket exits 0 (regression: server 500)', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'socket'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('shallow npm babel exits 0', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'babel'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('shallow npm nope exits 0 (server may stall)', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'nope'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)(
      'shallow npm <silent-no-data> exits 0 (server returns no data, not an error)',
      async () => {
        const result = await executeCliCommand([
          'package', 'shallow', 'npm', SILENT_NO_DATA_PKG,
        ])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN)('shallow npm socket --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'socket', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('shallow npm babel --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'babel', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('shallow npm nope --json conforms to contract', async () => {
      const result = await executeCliCommand(['package', 'shallow', 'npm', 'nope', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)(
      'shallow npm <silent-no-data> --json conforms to contract (ok:true with empty data)',
      async () => {
        const result = await executeCliCommand([
          'package', 'shallow', 'npm', SILENT_NO_DATA_PKG, '--json',
        ])
        expect(result.code).toBe(0)
        validateSocketJsonContract(result.stdout, 0)
      },
    )
  })
})
