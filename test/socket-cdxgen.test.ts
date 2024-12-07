import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import spawn from '@npmcli/promise-spawn'

import { distPath } from './dist/constants'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

const spawnOpts: PromiseSpawnOptions = {
  cwd: distPath,
  encoding: 'utf8'
}

describe('Socket cdxgen command', async () => {
  it('should forwards known commands to cdxgen', async () => {
    for (const command of ['-h', '--help']) {
      // eslint-disable-next-line no-await-in-loop
      const ret = await spawn('./cli.js', ['cdxgen', command], spawnOpts)
      assert.ok(ret.stdout.startsWith('cdxgen'), 'forwards commands to cdxgen')
    }
  })
  it('should not forward unknown commands to cdxgen', async () => {
    for (const command of ['-u', '--unknown']) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () => spawn('./cli.js', ['cdxgen', command], spawnOpts),
        e => e?.['stderr']?.startsWith(`Unknown argument: ${command}`),
        'singular'
      )
    }
    await assert.rejects(
      () => spawn('./cli.js', ['cdxgen', '-u', '-h', '--unknown'], spawnOpts),
      e => e?.['stderr']?.startsWith('Unknown arguments: -u, --unknown'),
      'plural'
    )
  })
})
