'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { describe, it } = require('node:test')

const spawn = require('@npmcli/promise-spawn')

const constants = require('../dist/constants.js')
const { NPM, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
for (const npmDir of ['npm8', 'npm10']) {
  const npmPath = path.join(npmFixturesPath, npmDir)
  const npmBinPath = path.join(npmPath, 'node_modules', '.bin')

  spawnSync(NPM, ['install', '--silent'], {
    cwd: npmPath,
    signal: abortSignal,
    stdio: 'ignore'
  })

  describe(`Socket npm wrapper for ${npmDir}`, () => {
    // Lazily access constants.rootBinPath.
    const entryPath = path.join(constants.rootBinPath, 'cli.js')

    it('should bail on new typosquat', async () => {
      await assert.doesNotReject(
        () =>
          new Promise((resolve, reject) => {
            const promise = spawn(
              // Lazily access constants.execPath.
              constants.execPath,
              [entryPath, NPM, 'install', 'bowserify'],
              {
                cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
                encoding: 'utf8',
                env: {
                  PATH: `${npmBinPath}:${process.env.PATH}`
                },
                signal: abortSignal
              }
            )
            promise.process.stderr.on('data', buffer => {
              if (buffer.toString().includes('Possible typosquat attack')) {
                promise.process.kill('SIGINT')
                resolve()
              }
            })
            promise.catch(() => {
              promise.process.kill('SIGINT')
              reject()
            })
          })
      )
    })
  })
}
