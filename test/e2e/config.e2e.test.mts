/**
 * @file E2E tests for the `socket config` command family. Covers: get /
 *   set / unset / auto at help / dry-run / no-args / valid-key. The tests use
 *   `executeCliInScratch` (isolated HOME / XDG_CONFIG_HOME) for any
 *   set/unset/auto call, so no real config file is touched. Gated on
 *   `RUN_E2E_TESTS=1`. Auto-discovery additionally requires authentication.
 */

import { describe, expect, it } from 'vitest'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import {
  executeCliCommand,
  executeCliInScratch,
} from '../helpers/cli-execution.mts'

const RUN = ENV.RUN_E2E_TESTS
const HAS_AUTH = RUN && Boolean(getDefaultApiToken())

describe('socket config (e2e)', () => {
  describe('top-level', () => {
    it.skipIf(!RUN)('config (no subcommand) exits 2', async () => {
      const result = await executeCliCommand(['config'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('config --help exits 0', async () => {
      const result = await executeCliCommand(['config', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('config --dry-run exits 0', async () => {
      const result = await executeCliCommand(['config', '--dry-run'])
      expect(result.code).toBe(0)
    })
  })

  describe('config get', () => {
    it.skipIf(!RUN)('config get --help exits 0', async () => {
      const result = await executeCliCommand(['config', 'get', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('config get --dry-run (no key) exits 2', async () => {
      const result = await executeCliCommand(['config', 'get', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('config get defaultOrg exits 0', async () => {
      // Scratch HOME so even a stray `~/.config/socket/...` read can't leak
      // into the test assertion.
      const result = await executeCliInScratch(['config', 'get', 'defaultOrg'])
      expect(result.code).toBe(0)
    })
  })

  describe('config set (scratch-isolated)', () => {
    it.skipIf(!RUN)('config set --help exits 0', async () => {
      const result = await executeCliCommand(['config', 'set', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('config set --dry-run (no key/value) exits 2', async () => {
      const result = await executeCliCommand(['config', 'set', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('config set defaultOrg <value> exits 0', async () => {
      // Scratch-isolated so the developer's real defaultOrg isn't overwritten.
      const result = await executeCliInScratch(
        ['config', 'set', 'defaultOrg', 'mydev'],
        { isolateConfig: false },
      )
      expect(result.code).toBe(0)
    })
  })

  describe('config unset (scratch-isolated)', () => {
    it.skipIf(!RUN)('config unset --help exits 0', async () => {
      const result = await executeCliCommand(['config', 'unset', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('config unset --dry-run (no key) exits 2', async () => {
      const result = await executeCliCommand(['config', 'unset', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!RUN)('config unset defaultOrg exits 0', async () => {
      const result = await executeCliInScratch([
        'config',
        'unset',
        'defaultOrg',
      ])
      expect(result.code).toBe(0)
    })
  })

  describe('config auto (scratch-isolated)', () => {
    it.skipIf(!RUN)('config auto --help exits 0', async () => {
      const result = await executeCliCommand(['config', 'auto', '--help'])
      expect(result.code).toBe(0)
    })

    it.skipIf(!RUN)('config auto --dry-run (no key) exits 2', async () => {
      const result = await executeCliCommand(['config', 'auto', '--dry-run'])
      expect(result.code).toBe(2)
    })

    it.skipIf(!HAS_AUTH)('config auto defaultOrg exits 0', async () => {
      const result = await executeCliInScratch(
        ['config', 'auto', 'defaultOrg', '--json'],
        { isolateConfig: false },
      )
      expect(result.code).toBe(0)
    })
  })
})
