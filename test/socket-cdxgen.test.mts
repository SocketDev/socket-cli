import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants from '../src/constants.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

const spawnOpts: PromiseSpawnOptions = {
  cwd: npmFixturesPath,
  env: {
    ...process.env,
    ...constants.processEnv,
    SOCKET_CLI_DEBUG: '1',
  },
}

describe('Socket manifest cdxgen command', async () => {
  const { binCliPath } = constants

  it(
    'should forwards known commands to cdxgen',
    {
      // Takes ~10s in CI
      timeout: 20_000,
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
