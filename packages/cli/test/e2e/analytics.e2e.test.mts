/**
 * @file E2E tests for the `socket analytics` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s analytics section (19 commands). Covers:
 *   default invocation / explicit scopes (org, repo, time-window), markdown +
 *   JSON output paths, --file output, and error-path checks for unknown flags /
 *   unknown scopes / unknown repos. Gated on `RUN_E2E_TESTS=1`. Auth-required
 *   tests additionally require a Socket API token.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import {
  executeCliCommand,
  executeCliInScratch,
  validateSocketJsonContract,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket analytics (e2e)', () => {
  describe('help and dry-run (no auth required)', () => {
    it.skipIf(!RUN)('analytics --help exits 0', async () => {
      const result = await executeCliCommand(['analytics', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('analytics --dry-run exits 0', async () => {
      const result = await executeCliCommand(['analytics', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('default / org / repo / time-window (auth required, scratch-isolated)', () => {
    it.skipIf(!RUN)('analytics (default scope) exits 0', async () => {
      const result = await executeCliInScratch(['analytics'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('analytics --markdown exits 0', async () => {
      const result = await executeCliInScratch(['analytics', '--markdown'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('analytics --json conforms to contract', async () => {
      const result = await executeCliInScratch(['analytics', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)('analytics org --json conforms to contract', async () => {
      const result = await executeCliInScratch(['analytics', 'org', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN)(
      'analytics repo socket-cli --json conforms to contract',
      async () => {
        const result = await executeCliInScratch([
          'analytics',
          'repo',
          'socket-cli',
          '--json',
        ])
        expect(result.code).toBe(0)
        validateSocketJsonContract(result.stdout, 0)
      },
    )

    it.skipIf(!RUN)('analytics org 7 --markdown exits 0', async () => {
      const result = await executeCliInScratch([
        'analytics',
        'org',
        '7',
        '--markdown',
      ])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)(
      'analytics repo socket-cli 30 --markdown exits 0',
      async () => {
        const result = await executeCliInScratch([
          'analytics',
          'repo',
          'socket-cli',
          '30',
          '--markdown',
        ])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN)('analytics 90 --json conforms to contract', async () => {
      const result = await executeCliInScratch(['analytics', '90', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })
  })

  describe('--file output (auth required, scratch-isolated)', () => {
    it.skipIf(!RUN)(
      'analytics --file <scratch>/out.txt --json exits 0',
      async () => {
        const result = await executeCliInScratch([
          'analytics',
          '--file',
          'out.txt',
          '--json',
        ])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN)(
      'analytics --file <scratch>/out.txt --markdown exits 0',
      async () => {
        const result = await executeCliInScratch([
          'analytics',
          '--file',
          'out.txt',
          '--markdown',
        ])
        expect(result.code).toBe(0)
      },
    )
  })

  describe('error paths', () => {
    it.skipIf(!RUN)('analytics --whatnow (unknown flag) exits 2', async () => {
      const result = await executeCliCommand(['analytics', '--whatnow'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)(
      'analytics --file out.txt (no format flag) exits 2',
      async () => {
        const result = await executeCliCommand([
          'analytics',
          '--file',
          'out.txt',
        ])
        expect(result.code).toBe(2)
      },
    )

    it.skipIf(!RUN)(
      'analytics rainbow --json (unknown scope) exits 2',
      async () => {
        const result = await executeCliCommand([
          'analytics',
          'rainbow',
          '--json',
        ])
        expect(result.code).toBe(2)
      },
    )

    it.skipIf(!RUN)(
      'analytics repo veryunknownrepo --json (unknown repo) exits 1',
      async () => {
        const result = await executeCliInScratch([
          'analytics',
          'repo',
          'veryunknownrepo',
          '--json',
        ])
        expect(result.code).toBe(1)
      },
    )

    it.skipIf(!RUN)(
      'analytics repo 30 --markdown (no repo name) exits 2',
      async () => {
        const result = await executeCliCommand([
          'analytics',
          'repo',
          '30',
          '--markdown',
        ])
        expect(result.code).toBe(2)
      },
    )

    it.skipIf(!RUN)(
      'analytics org 25 --markdown (invalid time-window) exits 2',
      async () => {
        const result = await executeCliCommand([
          'analytics',
          'org',
          '25',
          '--markdown',
        ])
        expect(result.code).toBe(2)
      },
    )

    it.skipIf(!RUN)(
      'analytics 123 --json (invalid time-window) exits 2',
      async () => {
        const result = await executeCliCommand(['analytics', '123', '--json'])
        expect(result.code).toBe(2)
      },
    )
  })
})
