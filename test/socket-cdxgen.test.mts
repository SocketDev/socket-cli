import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

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
    SOCKET_CLI_DEBUG: '1',
  },
}

describe('Socket manifest cdxgen command', async () => {
  // Lazily access constants.binCliPath.
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
          // Lazily access constants.execPath.
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', '--yes', command],
          spawnOpts,
        )
        expect(
          output.stdout.includes('cdxgen'),
          'forwards commands to cdxgen',
        ).toBe(true)
      }
    },
  )

  describe('command forwarding', async () => {
    expect.extend({
      toHaveStderrInclude(received, expected) {
        const { isNot } = this
        return {
          // do not alter your "pass" based on isNot. Vitest does it for you
          pass: received?.stderr?.includes?.(expected) ?? false,
          message: () =>
            `spawn.stderr ${isNot ? 'does NOT include' : 'includes'} \`${expected}\`: ${received?.stderr}`,
        }
      },
    })

    it('should not forward -u to cdxgen', async () => {
      const command = '-u'
      await expect(
        () =>
          spawn(
            // Lazily access constants.execPath.
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '-y', command],
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
            // Lazily access constants.execPath.
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '--yes', command],
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
            // Lazily access constants.execPath.
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '-y', '-u', '-h', '--unknown'],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown arguments: -u, --unknown`,
      )
    })
  })
})
