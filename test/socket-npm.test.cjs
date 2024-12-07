'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { describe, it } = require('node:test')

const spawn = require('@npmcli/promise-spawn')

const constants = require('../scripts/constants')
const { distPath } = constants

const testPath = __dirname
const entryPath = path.join(distPath, 'cli.js')
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
for (const npm of ['npm8', 'npm10']) {
  const npmPath = path.join(npmFixturesPath, npm)
  const npmBinPath = path.join(npmPath, 'node_modules', '.bin')

  spawnSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--no-progress', '--quiet'],
    {
      cwd: npmPath,
      stdio: 'ignore'
    }
  )

  describe(`Socket npm wrapper for ${npm}`, () => {
    it('should bail on new typosquat', async () => {
      try {
        await spawn(
          process.execPath,
          [entryPath, 'npm', 'install', 'bowserify'],
          {
            cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
            encoding: 'utf8',
            env: {
              // Make sure we don't borrow TTY from parent.
              SOCKET_SECURITY_TTY_IPC: undefined,
              PATH: `${npmBinPath}:${process.env.PATH}`
            }
          }
        )
        assert.ok(false, 'typosquat not error')
      } catch (e) {
        assert.ok(e?.stderr.includes('Unable to prompt'), e?.stderr)
      }
    })
  })
}
