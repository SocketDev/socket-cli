'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { describe, it } = require('node:test')

const testPath = __dirname
const entryPath = path.resolve(testPath, '../dist/cli.js')

function spawnNPM({ args = [], cwd, installDir }) {
  return spawnSync(process.execPath, [entryPath, 'npm', ...args], {
    cwd: path.join(testPath, cwd),
    encoding: 'utf8',
    env: {
      // make sure we don't borrow TTY from parent
      SOCKET_SECURITY_TTY_IPC: undefined,
      PATH: `${path.join(installDir, 'node_modules', '.bin')}:${process.env.PATH}`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

// these aliases are defined in package.json
for (const npm of ['npm8', 'npm10']) {
  const installDir = path.join(testPath, `/socket-npm-fixtures/${npm}`)
  spawnSync('npm', ['install'], {
    cwd: installDir,
    stdio: 'ignore'
  })

  describe(`Socket npm wrapper for ${npm}`, () => {
    it('should bail on new typosquat', () => {
      const ret = spawnNPM({
        cwd: './socket-npm-fixtures/lacking-typosquat',
        installDir,
        args: ['i', 'bowserify']
      })
      assert.equal(ret.status, 1)
      assert.ok(ret.stderr.includes('Unable to prompt'))
    })
  })
}
