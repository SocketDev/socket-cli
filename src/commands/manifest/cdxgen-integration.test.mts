import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import { testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

describe('Socket manifest cdxgen command', async () => {
  const { binCliPath } = constants

  const spawnOpts: PromiseSpawnOptions = {
    cwd: path.join(testPath, 'fixtures/commands/cdxgen'),
    env: {
      ...process.env,
      ...constants.processEnv,
      SOCKET_CLI_DEBUG: '1',
    },
  }

  it(
    'should forwards known commands to cdxgen',
    {
      // Increase timeout for CI environments where cdxgen downloads can be slow.
      timeout: 60_000,
    },
    async () => {
      for (const command of ['-h', '--help']) {
        // eslint-disable-next-line no-await-in-loop
        const output = await spawn(
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        )
        expect(
          output.stdout.includes('CycloneDX Generator'),
          'forwards commands to cdxgen',
        ).toBe(true)
      }
    },
  )

  describe('command forwarding', async () => {
    expect.extend({
      toHaveStderrInclude(received, expected) {
        const { isNot } = this
        const strippedExpected = stripAnsi(expected)
        const stderr = received?.stderr
        return {
          // do not alter your "pass" based on isNot. Vitest does it for you
          pass: stderr?.includes?.(strippedExpected) ?? false,
          message: () =>
            `spawn.stderr ${isNot ? 'does NOT include' : 'includes'} \`${strippedExpected}\`: ${stderr}`,
        }
      },
    })

    it('should not forward -u to cdxgen', async () => {
      const command = '-u'
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', command],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    it('should not forward --unknown to cdxgen', async () => {
      const command = '--unknown'
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', command],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    it('should not forward multiple unknown commands to cdxgen', async () => {
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '-u', '-h', '--unknown'],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown arguments: -u, --unknown`,
      )
    })
  })
})
