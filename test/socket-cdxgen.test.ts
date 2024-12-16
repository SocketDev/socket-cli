import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import spawn from '@npmcli/promise-spawn'

import constants from '../dist/constants.js'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

const { abortSignal, execPath, rootBinPath } = constants

const entryPath = path.join(rootBinPath, 'cli.js')
const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

const spawnOpts: PromiseSpawnOptions = {
  cwd: npmFixturesPath,
  encoding: 'utf8',
  signal: abortSignal
}

describe('Socket cdxgen command', async () => {
  it('should forwards known commands to cdxgen', async () => {
    for (const command of ['-h', '--help']) {
      // eslint-disable-next-line no-await-in-loop
      const ret = await spawn(
        execPath,
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
        () => spawn(execPath, [entryPath, 'cdxgen', command], spawnOpts),
        e => e?.['stderr']?.startsWith(`Unknown argument: ${command}`),
        'singular'
      )
    }
    await assert.rejects(
      () =>
        spawn(
          execPath,
          [entryPath, 'cdxgen', '-u', '-h', '--unknown'],
          spawnOpts
        ),
      e => e?.['stderr']?.startsWith('Unknown arguments: -u, --unknown'),
      'plural'
    )
  })
})
