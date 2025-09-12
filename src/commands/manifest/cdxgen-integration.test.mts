import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import { cleanOutput, testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

function createIncludeMatcher(streamName: 'stdout' | 'stderr') {
  return function (received: any, expected: string) {
    const { isNot } = this
    const strippedExpected = cleanOutput(expected)
    const stream = cleanOutput(received?.[streamName] || '')
    return {
      // Do not alter your "pass" based on isNot. Vitest does it for you.
      pass: !!stream?.includes?.(strippedExpected),
      message: () =>
        `spawn.${streamName} ${isNot ? 'does NOT include' : 'includes'} \`${strippedExpected}\`: ${stream}`,
    }
  }
}

expect.extend({
  toHaveStdoutInclude: createIncludeMatcher('stdout'),
  toHaveStderrInclude: createIncludeMatcher('stderr'),
})

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

  describe('command forwarding', async () => {
    it.skipIf(constants.WIN32 && constants.ENV.CI)(
      'should forward known flags to cdxgen',
      {
        // Increase timeout for CI environments where cdxgen downloads can be slow.
        timeout: 60_000,
      },
      async () => {
        for (const command of ['-h', '--help']) {
          // eslint-disable-next-line no-await-in-loop
          await expect(
            () =>
              spawn(
                constants.execPath,
                [binCliPath, 'manifest', 'cdxgen', command],
                spawnOpts,
              ),
            // @ts-ignore toHaveStdoutInclude is defined above.
          ).resolves.toHaveStdoutInclude('CycloneDX Generator')
        }
      },
    )

    it('should not forward an unknown short flag to cdxgen', async () => {
      const command = '-u'
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', command],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above.
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    it('should not forward an unknown flag to cdxgen', async () => {
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

    it('should not forward multiple unknown flags to cdxgen', async () => {
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
