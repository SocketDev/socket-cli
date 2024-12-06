'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { describe, it } = require('node:test')

const constants = require('../scripts/constants')
const { distPath } = constants

const testPath = __dirname
const entryPath = path.join(distPath, 'cli.js')

function spawnNPM({ args = [], cwd, installDir }) {
  return spawnSync(process.execPath, [entryPath, 'npm', ...args], {
    cwd: path.join(testPath, cwd),
    encoding: 'utf8',
    env: {
      // Make sure we don't borrow TTY from parent.
      SOCKET_SECURITY_TTY_IPC: undefined,
      PATH: `${path.join(installDir, 'node_modules', '.bin')}:${process.env.PATH}`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

// These aliases are defined in package.json.
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
      assert.strictEqual(ret.status, 1, ret.stderr)
      assert.ok(ret.stderr.includes('Unable to prompt'), ret.stderr)
    })
  })
}
