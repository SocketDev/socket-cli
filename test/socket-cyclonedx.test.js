import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { $ } from 'execa'

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Use `node: true` instead of `preferLocal: true` to make Ubuntu CI tests happy.
const localOpts = { cwd, node: true, reject: false }

describe('Socket cyclonedx command', async () => {
  it('should forwards known commands to cdxgen', async () => {
    for (const command of ['-h', '--help']) {
      const ret = await $(localOpts)`cli.js cyclonedx ${command}`
      assert(ret.stdout.startsWith('cdxgen'), 'forwards commands to cdxgen')
    }
  })
  it('should not forward unknown commands to cdxgen', async () => {
    for (const command of ['-u', '--unknown']) {
      const ret = await $(localOpts)`cli.js cyclonedx ${command}`
      assert(ret.stderr.startsWith(`Unknown argument: ${command}`), 'singular')
    }
    const ret = await $(localOpts)`cli.js cyclonedx -u -h --unknown`
    assert(ret.stderr.startsWith('Unknown arguments: -u, --unknown'), 'plural')
  })
})
