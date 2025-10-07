import { describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import constants, { FLAG_HELP } from '../../constants.mts'

import type { PromiseSpawnOptions } from '@socketsecurity/registry/lib/spawn'

describe('socket manifest cdxgen', async () => {
  const { binCliPath } = constants

  const spawnOpts: PromiseSpawnOptions = {
    env: {
      ...process.env,
      ...constants.processEnv,
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

        // Verify command exits successfully
        expect(code, 'help command should exit with code 0').toBe(0)

        // Verify we got output (cdxgen worked or at minimum Socket CLI banner appeared)
        const combinedOutput = stdout + stderr
        const hasOutput = combinedOutput.length > 0
        expect(hasOutput, 'should produce output').toBe(true)

        // Verify no error indicators in output
        const hasErrorIndicators =
          combinedOutput.toLowerCase().includes('error:') ||
          combinedOutput.toLowerCase().includes('failed')
        expect(hasErrorIndicators, 'should not contain error indicators').toBe(
          false,
        )
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
          // eslint-disable-next-line no-await-in-loop
          const result = await spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', command],
            spawnOpts,
          )

          // Verify command exits successfully
          expect(result.code, 'help flag should exit with code 0').toBe(0)

          // Verify we got output
          const combinedOutput = result.stdout + result.stderr
          expect(
            combinedOutput.length,
            'should produce output',
          ).toBeGreaterThan(0)

          // Verify no error indicators
          const hasErrorIndicators =
            combinedOutput.toLowerCase().includes('error:') ||
            combinedOutput.toLowerCase().includes('failed')
          expect(
            hasErrorIndicators,
            'should not contain error indicators',
          ).toBe(false)
        }
      },
    )

    // Note: Unknown flag validation was removed in commit de9fa089
    // ("Simplify cdxgen command forwarding to remove complex validation").
    // The command now forwards all flags to cdxgen, which handles validation.
  })
})
