'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { describe, it } = require('node:test')

const spawn = require('@npmcli/promise-spawn')

const constants = require('../scripts/constants')
const { distPath, execPath } = constants

const entryPath = path.join(distPath, 'cli.js')
const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
for (const npm of ['npm8', 'npm10']) {
  const npmPath = path.join(npmFixturesPath, npm)
  const npmBinPath = path.join(npmPath, 'node_modules', '.bin')

  spawnSync('npm', ['install', '--silent'], {
    cwd: npmPath,
    stdio: 'ignore'
  })

  describe(`Socket npm wrapper for ${npm}`, () => {
    it('should bail on new typosquat', async () => {
      await assert.rejects(
        () =>
          spawn(execPath, [entryPath, 'npm', 'install', 'bowserify'], {
            cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
            encoding: 'utf8',
            env: {
              // Make sure we don't borrow TTY from parent.
              SOCKET_SECURITY_TTY_IPC: undefined,
              PATH: `${npmBinPath}:${process.env.PATH}`
            }
          }),
        e => e?.stderr.includes('Unable to prompt')
      )
    })
  })
}
