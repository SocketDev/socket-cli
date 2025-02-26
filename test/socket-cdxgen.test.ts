import path from 'node:path'

import spawn from '@npmcli/promise-spawn'
import { describe, expect, it } from 'vitest'

import constants from '../dist/constants.js'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

const { CLI, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

const spawnOpts: PromiseSpawnOptions = {
  cwd: npmFixturesPath,
  signal: abortSignal
}

describe('Socket cdxgen command', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  it('should forwards known commands to cdxgen', async () => {
    for (const command of ['-h', '--help']) {
      // eslint-disable-next-line no-await-in-loop
      const ret = await spawn(
        // Lazily access constants.execPath.
        constants.execPath,
        [entryPath, 'cdxgen', command],
        spawnOpts
      )
      expect(
        ret.stdout.startsWith('cdxgen'),
        'forwards commands to cdxgen'
      ).toBe(true)
    }
    // Takes ~10s in CI
  }, 20_000)

  describe('command forwarding', async () => {
    expect.extend({
      toHaveStderrStartWith(received, expected) {
        // console.log('got:', received)
        const { isNot } = this
        return {
          // do not alter your "pass" based on isNot. Vitest does it for you
          pass: received?.stderr?.startsWith?.(expected) ?? false,
          message: () =>
            `spawn.stderr did${isNot ? ' not' : ''} start with \`${expected}\`: ${received?.stderr}`
        }
      }
    })

    it('should not forward -u to cdxgen', async () => {
      const command = '-u'
      await expect(
        () =>
          spawn(
            // Lazily access constants.execPath.
            constants.execPath,
            [entryPath, 'cdxgen', command],
            spawnOpts
          )
        // @ts-ignore -- toHaveStderrStartWith is defined above
      ).rejects.toHaveStderrStartWith(`Unknown argument: ${command}`)
    })

    it('should not forward --unknown to cdxgen', async () => {
      const command = '--unknown'
      await expect(
        () =>
          spawn(
            // Lazily access constants.execPath.
            constants.execPath,
            [entryPath, 'cdxgen', command],
            spawnOpts
          )
        // @ts-ignore -- toHaveStderrStartWith is defined above
      ).rejects.toHaveStderrStartWith(`Unknown argument: ${command}`)
    })

    it('should not forward multiple unknown commands to cdxgen', async () => {
      await expect(
        () =>
          spawn(
            // Lazily access constants.execPath.
            constants.execPath,
            [entryPath, 'cdxgen', '-u', '-h', '--unknown'],
            spawnOpts
          )
        // @ts-ignore -- toHaveStderrStartWith is defined above
      ).rejects.toHaveStderrStartWith('Unknown arguments: -u, --unknown')
    })
  })
})
