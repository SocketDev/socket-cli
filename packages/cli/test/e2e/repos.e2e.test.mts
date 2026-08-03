/**
 * @file E2E tests for the `socket repos` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s repos section (17 commands). Most repos
 *   checks are help / dry-run / read-only and run under the normal
 *   `RUN_E2E_TESTS=1` gate. The create → update → view → del round-trip writes
 *   real org-side state via the Socket API, so it lives behind a second gate
 *   (`RUN_E2E_DESTRUCTIVE=1`) and uses a `cli-e2e-<pid>-<timestamp>` repo name
 *   so concurrent runs don't collide and a stale repo from a crashed run is
 *   easy to identify. afterAll best-effort deletes the test repo, but the
 *   round-trip's own `del` step is the primary cleanup; afterAll only catches
 *   mid-run aborts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import {
  executeCliCommand,
  executeCliInScratch,
  validateSocketJsonContract,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS
const RUN_DESTRUCTIVE = process.env['RUN_E2E_DESTRUCTIVE'] === '1'

describe('socket repos (e2e)', () => {
  let hasAuth = false

  beforeAll(async () => {
    if (RUN) {
      hasAuth = !!getDefaultApiToken()
    }
  })

  describe('help and dry-run (no auth required)', () => {
    it.skipIf(!RUN)('repos (no subcommand) exits 2', async () => {
      const result = await executeCliCommand(['repos'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('repos --help exits 0', async () => {
      const result = await executeCliCommand(['repos', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos --dry-run exits 0', async () => {
      const result = await executeCliCommand(['repos', '--dry-run'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos create --help exits 0', async () => {
      const result = await executeCliCommand(['repos', 'create', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos create --dry-run (no name) exits 2', async () => {
      const result = await executeCliCommand(['repos', 'create', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('repos update --help exits 0', async () => {
      const result = await executeCliCommand(['repos', 'update', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos update --dry-run (no name) exits 2', async () => {
      const result = await executeCliCommand(['repos', 'update', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('repos view --help exits 0', async () => {
      const result = await executeCliCommand(['repos', 'view', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos view --dry-run (no name) exits 2', async () => {
      const result = await executeCliCommand(['repos', 'view', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('repos del --help exits 0', async () => {
      const result = await executeCliCommand(['repos', 'del', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('repos del --dry-run (no name) exits 2', async () => {
      const result = await executeCliCommand(['repos', 'del', '--dry-run'])
      expect(result.code).toBe(2)
    })
  })

  describe('error paths (auth required, read-only, scratch-isolated)', () => {
    it.skipIf(!RUN || !hasAuth)(
      'repos view <nonexistent> --json conforms to error contract',
      async () => {
        const result = await executeCliInScratch([
          'repos',
          'view',
          'cli_donotcreate',
          '--json',
        ])
        expect(result.code).toBe(1)
        validateSocketJsonContract(result.stdout, 1)
      },
    )

    it.skipIf(!RUN || !hasAuth)(
      'repos update <nonexistent> --homepage evil --json conforms to error contract',
      async () => {
        const result = await executeCliInScratch([
          'repos',
          'update',
          'cli_donotcreate',
          '--homepage',
          'evil',
          '--json',
        ])
        expect(result.code).toBe(1)
        validateSocketJsonContract(result.stdout, 1)
      },
    )
  })

  describe('create → update → view → del round-trip (destructive)', () => {
    // The repo name encodes the pid + timestamp so concurrent CI runs don't
    // collide, and a leaked repo from a crashed run is easy to identify.
    const repoName = `cli-e2e-${process.pid}-${Date.now()}`

    afterAll(async () => {
      if (!RUN || !hasAuth || !RUN_DESTRUCTIVE) {
        return
      }
      // Best-effort cleanup; the round-trip's own `del` step is primary.
      try {
        await executeCliInScratch(['repos', 'del', repoName])
      } catch {
        // Repo may already be deleted by the round-trip's del step.
      }
    })

    it.skipIf(!RUN || !hasAuth || !RUN_DESTRUCTIVE)(
      'creates a uniquely-named repo',
      async () => {
        const result = await executeCliInScratch(['repos', 'create', repoName])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN || !hasAuth || !RUN_DESTRUCTIVE)(
      'updates the homepage on the created repo',
      async () => {
        const result = await executeCliInScratch([
          'repos',
          'update',
          repoName,
          '--homepage',
          'socket.dev',
        ])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN || !hasAuth || !RUN_DESTRUCTIVE)(
      'views the created repo',
      async () => {
        const result = await executeCliInScratch(['repos', 'view', repoName])
        expect(result.code).toBe(0)
      },
    )

    it.skipIf(!RUN || !hasAuth || !RUN_DESTRUCTIVE)(
      'deletes the created repo',
      async () => {
        const result = await executeCliInScratch(['repos', 'del', repoName])
        expect(result.code).toBe(0)
      },
    )
  })
})
