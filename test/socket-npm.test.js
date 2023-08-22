import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const entryPath = fileURLToPath(new URL('../cli.js', import.meta.url))

/**
 * Run relative to current file
 *
 * @param {object} param0
 * @param {string} param0.cwd
 * @param {string[]} [param0.args]
 * @param {import('node:child_process').ProcessEnvOptions['env'] | undefined} [param0.env]
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function spawnNPM ({ cwd, args = [], env }) {
  const pwd = fileURLToPath(new URL(cwd, import.meta.url))
  return spawnSync(process.execPath, [entryPath, 'npm', ...args], {
    cwd: pwd,
    encoding: 'utf-8',
    env: {
      ...(env ?? process.env),
      // make sure we don't borrow TTY from parent
      SOCKET_SECURITY_TTY_IPC: undefined
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

describe('Socket npm wrapper', () => {
  it('should bail on new typosquat', () => {
    const ret = spawnNPM({
      cwd: './socket-npm-fixtures/lacking-typosquat',
      args: ['i', 'bowserify']
    })
    assert.equal(ret.status, 1)
    assert.match(ret.stderr, /Unable to prompt/)
  })
})
