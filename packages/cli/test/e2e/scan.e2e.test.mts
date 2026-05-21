/**
 * @file E2E tests for the `socket scan` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s scan section. Exercises help, dry-run,
 *   list/view/metadata/report/diff, and `--json` contract conformance.
 *
 *   Every auth-required call runs inside `executeCliInScratch` so:
 *   - any cwd-side `.socket/` artifacts land in the scratch tree
 *   - the CLI can't persist new credentials/config to the dev's HOME
 *   - npm/pnpm/yarn caches are pinned to scratch too
 *
 *   Gated on `RUN_E2E_TESTS=1`. Auth-required tests additionally require a
 *   Socket API token to be present.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import {
  executeCliCommand,
  executeCliInScratch,
  validateSocketJsonContract,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS

describe('socket scan (e2e)', () => {
  let hasAuth = false

  beforeAll(async () => {
    if (RUN) {
      hasAuth = !!(await getDefaultApiToken())
    }
  })

  describe('help and dry-run (no auth required)', () => {
    it.skipIf(!RUN)('exits 2 with no subcommand (prints help)', async () => {
      const result = await executeCliCommand(['scan'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan --help exits 0', async () => {
      const result = await executeCliCommand(['scan', '--help'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('scan')
    })

    it.skipIf(!RUN)('scan --dry-run exits 0', async () => {
      const result = await executeCliCommand(['scan', '--dry-run'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan create --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'create', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan create --dry-run (no target) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'create', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan del --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'del', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan del --dry-run exits 2', async () => {
      const result = await executeCliCommand(['scan', 'del', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan list --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'list', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan list --dry-run exits 0', async () => {
      const result = await executeCliCommand(['scan', 'list', '--dry-run'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan view --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'view', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan view (no id) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'view'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan view --dry-run (no id) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'view', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan metadata --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'metadata', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan metadata --dry-run (no id) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'metadata', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan report --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'report', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan report --dry-run (no id) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'report', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('scan diff --help exits 0', async () => {
      const result = await executeCliCommand(['scan', 'diff', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('scan diff --dry-run (no ids) exits 2', async () => {
      const result = await executeCliCommand(['scan', 'diff', '--dry-run'])
      expect(result.code).toBe(2)
    })
  })

  describe('list / view / metadata / report / diff (auth required)', () => {
    let sbomId: string | undefined
    let secondSbomId: string | undefined

    beforeAll(async () => {
      if (!RUN || !hasAuth) {
        return
      }
      // Resolve the two most-recent scan IDs for the configured default org.
      // These feed the per-id checks below.
      const result = await executeCliInScratch(['scan', 'list', '--json'])
      if (result.code === 0) {
        try {
          const payload = JSON.parse(result.stdout) as {
            data?: { results?: Array<{ id?: string | undefined }> | undefined } | undefined
          }
          const results = payload.data?.results
          if (Array.isArray(results)) {
            sbomId = results[0]?.id
            secondSbomId = results[1]?.id
          }
        } catch {
          // Fall through — per-id tests will skip themselves below.
        }
      }
    })

    it.skipIf(!RUN || !hasAuth)('scan list exits 0', async () => {
      const result = await executeCliInScratch(['scan', 'list'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan list --json conforms to contract', async () => {
      const result = await executeCliInScratch(['scan', 'list', '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN || !hasAuth)('scan list --markdown exits 0', async () => {
      const result = await executeCliInScratch(['scan', 'list', '--markdown'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan view <id> exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'view', sbomId])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan view <id> --json conforms to contract', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'view', sbomId, '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN || !hasAuth)('scan view <id> --markdown exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'view', sbomId, '--markdown'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan metadata <id> exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'metadata', sbomId])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan metadata <id> --json conforms to contract', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'metadata', sbomId, '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN || !hasAuth)('scan metadata <id> --markdown exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'metadata', sbomId, '--markdown'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan report <id> exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'report', sbomId])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan report <id> --json conforms to contract', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'report', sbomId, '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN || !hasAuth)('scan report <id> --markdown exits 0', async () => {
      if (!sbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'report', sbomId, '--markdown'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan diff <id1> <id2> exits 0', async () => {
      if (!sbomId || !secondSbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'diff', sbomId, secondSbomId])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN || !hasAuth)('scan diff --json conforms to contract', async () => {
      if (!sbomId || !secondSbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'diff', sbomId, secondSbomId, '--json'])
      expect(result.code).toBe(0)
      validateSocketJsonContract(result.stdout, 0)
    })

    it.skipIf(!RUN || !hasAuth)('scan diff --markdown exits 0', async () => {
      if (!sbomId || !secondSbomId) {
        return
      }
      const result = await executeCliInScratch(['scan', 'diff', sbomId, secondSbomId, '--markdown'])
      expect(result.code).toBe(0)
    })
  })

  describe('scan create (auth required, scratch-isolated)', () => {
    it.skipIf(!RUN || !hasAuth)(
      'scan create . exits 0 with --json contract',
      async () => {
        const result = await executeCliInScratch(['scan', 'create', '.', '--json'], {
          seedFiles: {
            'package.json': JSON.stringify({ name: 'socket-cli-e2e-scan', version: '0.0.0' }),
          },
        })
        expect(result.code).toBe(0)
        validateSocketJsonContract(result.stdout, 0)
      },
    )
  })

  describe('error paths — non-existent org', () => {
    it.skipIf(!RUN || !hasAuth)(
      'scan create --org fake_org exits 1',
      async () => {
        const result = await executeCliInScratch(
          ['scan', 'create', '.', '--org', 'fake_org', '--json'],
          {
            seedFiles: {
              'package.json': JSON.stringify({ name: 'socket-cli-e2e-fake-org', version: '0.0.0' }),
            },
          },
        )
        expect(result.code).toBe(1)
        validateSocketJsonContract(result.stdout, 1)
      },
    )

    it.skipIf(!RUN || !hasAuth)('scan view --org fake_org exits 1', async () => {
      const result = await executeCliInScratch(['scan', 'view', 'placeholder', '--org', 'fake_org', '--json'])
      expect(result.code).toBe(1)
      validateSocketJsonContract(result.stdout, 1)
    })

    it.skipIf(!RUN || !hasAuth)('scan report --org fake_org exits 1', async () => {
      const result = await executeCliInScratch(['scan', 'report', 'placeholder', '--org', 'fake_org', '--json'])
      expect(result.code).toBe(1)
      validateSocketJsonContract(result.stdout, 1)
    })

    it.skipIf(!RUN || !hasAuth)('scan metadata --org fake_org exits 1', async () => {
      const result = await executeCliInScratch(['scan', 'metadata', 'placeholder', '--org', 'fake_org', '--json'])
      expect(result.code).toBe(1)
      validateSocketJsonContract(result.stdout, 1)
    })

    it.skipIf(!RUN || !hasAuth)('scan diff --org fake_org exits 1', async () => {
      const result = await executeCliInScratch([
        'scan', 'diff', 'placeholder', 'placeholder', '--org', 'fake_org', '--json',
      ])
      expect(result.code).toBe(1)
      validateSocketJsonContract(result.stdout, 1)
    })
  })
})
