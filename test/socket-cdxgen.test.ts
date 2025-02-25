import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import spawn from '@npmcli/promise-spawn'

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
      assert.ok(ret.stdout.startsWith('cdxgen'), 'forwards commands to cdxgen')
    }
  })
  it('should not forward unknown commands to cdxgen', async () => {
    for (const command of ['-u', '--unknown']) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () =>
          // Lazily access constants.execPath.
          spawn(constants.execPath, [entryPath, 'cdxgen', command], spawnOpts),
        e => e?.['stderr']?.startsWith(`Unknown argument: ${command}`),
        'singular'
      )
    }
    await assert.rejects(
      () =>
        spawn(
          // Lazily access constants.execPath.
          constants.execPath,
          [entryPath, 'cdxgen', '-u', '-h', '--unknown'],
          spawnOpts
        ),
      e => e?.['stderr']?.startsWith('Unknown arguments: -u, --unknown'),
      'plural'
    )
  })
})
