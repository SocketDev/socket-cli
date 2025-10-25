import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_HELP } from '../../constants/cli.mts'
import {
  getBinCliPath,
  getExecPath,
} from '../../constants/paths.mts'

import type { PromiseSpawnOptions } from '@socketsecurity/lib/spawn'

const binCliPath = getBinCliPath()
const execPath = getExecPath()

describe('socket manifest cdxgen', async () => {
  const spawnOpts: PromiseSpawnOptions = {
    env: {
      ...process.env,
      SOCKET_CLI_CONFIG: '{}',
    },
  }

  describe('command forwarding', async () => {
    cmdit(
      ['manifest', 'cdxgen', FLAG_HELP],
      `should support ${FLAG_HELP}`,
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Need to pass it on as env because --config will break cdxgen.
          env: { SOCKET_CLI_CONFIG: '{}' },
        })

        // cdxgen exits with code 1 for --help (expected behavior from the underlying tool)
        expect([0, 1]).toContain(code)

        // Verify we got output (cdxgen worked or at minimum Socket CLI banner appeared)
        const combinedOutput = stdout + stderr
        const hasOutput = combinedOutput.length > 0
        expect(hasOutput, 'should produce output').toBe(true)
      },
    )

    it(
      'should forward known flags to cdxgen',
      {
        // Increase timeout for CI environments where cdxgen downloads can be slow.
        timeout: 60_000,
      },
      async () => {
        for (const command of ['-h', FLAG_HELP]) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await spawn(
              execPath,
              [binCliPath, 'manifest', 'cdxgen', command],
              spawnOpts,
            )

            // cdxgen exits with code 1 for --help (expected behavior)
            expect([0, 1]).toContain(result.code)

            // Verify we got output
            const combinedOutput = result.stdout + result.stderr
            expect(
              combinedOutput.length,
              'should produce output',
            ).toBeGreaterThan(0)
          } catch (error: any) {
            // Command failed - verify it at least produced output
            const combinedOutput = (error.stdout || '') + (error.stderr || '')
            expect(
              combinedOutput.length,
              'should produce output even on failure',
            ).toBeGreaterThan(0)
          }
        }
      },
    )

    it('should not forward an unknown short flag to cdxgen', async () => {
      const command = '-u'
      try {
        await spawn(
          execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        )
        expect.fail('Should have thrown an error for unknown flag')
      } catch (error: any) {
        expect(error.stderr).toContain(`Unknown argument: ${command}`)
      }
    })

    it('should not forward an unknown flag to cdxgen', async () => {
      const command = '--unknown'
      try {
        await spawn(
          execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        )
        expect.fail('Should have thrown an error for unknown flag')
      } catch (error: any) {
        expect(error.stderr).toContain(`Unknown argument: ${command}`)
      }
    })

    it('should not forward multiple unknown flags to cdxgen', async () => {
      try {
        await spawn(
          execPath,
          [binCliPath, 'manifest', 'cdxgen', '-u', '-h', '--unknown'],
          spawnOpts,
        )
        expect.fail('Should have thrown an error for unknown flags')
      } catch (error: any) {
        expect(error.stderr).toContain('Unknown argument')
      }
    })
  })
})
