import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// these aliases are defined in package.json
const npms = ['npm8', 'npm10']

const cli = fileURLToPath(new URL('../cli.js', import.meta.url))

for (const npm of npms) {
  const installDir = fileURLToPath(new URL(`./socket-npm-fixtures/${npm}`, import.meta.url))
  spawnSync('npm', ['install'], {
    cwd: installDir,
    stdio: 'inherit'
  })
  console.error(process.execPath)
  describe(`Socket npm wrapper for ${npm}`, () => {
  /**
   * Run relative to current file
   * @param {object} param0
   * @param {string} param0.cwd
   * @param {string[]} [param0.args]
   * @param {import('node:child_process').ProcessEnvOptions['env'] | undefined} [param0.env]
   * @returns {import('node:child_process').SpawnSyncReturns<string>}
   */
  function spawnNPM ({ cwd, args = [], env }) {
    const pwd = fileURLToPath(new URL(cwd, import.meta.url))
    return spawnSync(process.execPath, [cli, 'npm', ...args], {
      cwd: pwd,
      encoding: 'utf-8',
      env: {
        ...(env ?? process.env),
        // make sure we don't borrow TTY from parent
        SOCKET_SECURITY_TTY_IPC: undefined,
        // @ts-ignore
        PATH: `${path.join(installDir, 'node_modules', '.bin')}:${process.env.PATH}`
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
    it('should bail on new typosquat', () => {
      const ret = spawnNPM({
        cwd: fileURLToPath(new URL('./socket-npm-fixtures/lacking-typosquat', import.meta.url)),
        args: ['i', 'bowserify']
      })
      assert.equal(ret.status, 1)
      assert.match(ret.stderr, /Unable to prompt/)
    })
  })
}
