import { describe, expect, it } from 'vitest'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const process = require('node:process')

const spawn = require('@npmcli/promise-spawn')

const constants = require('../dist/constants.js')

const { NODE_MODULES, NPM, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
const versions = ['npm8', 'npm10']
for (const npmDir of versions) {
  const npmPath = path.join(npmFixturesPath, npmDir)
  const npmBinPath = path.join(npmPath, NODE_MODULES, '.bin')

  spawnSync(NPM, ['install', '--silent'], {
    cwd: npmPath,
    signal: abortSignal,
    stdio: 'ignore'
  })

  describe(`Socket npm wrapper for ${npmDir}`, () => {
    // Lazily access constants.rootBinPath.
    const entryPath = path.join(constants.rootBinPath, 'cli.js')

    it('should bail on new typosquat', async () => {
      await new Promise((resolve, reject) => {
        const spawnPromise = spawn(
          // Lazily access constants.execPath.
          constants.execPath,
          [entryPath, NPM, 'install', 'bowserify'],
          {
            cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
            env: {
              PATH: `${npmBinPath}:${process.env.PATH}`
            },
            signal: abortSignal
          }
        )

        spawnPromise.process.stderr.on('data', buffer => {
          if (buffer.toString().includes('Possible typosquat attack')) {
            spawnPromise.process.kill('SIGINT')
            resolve()
          }
        })

        spawnPromise.catch(() => {
          spawnPromise.process.kill('SIGINT')
          reject()
        })
      })

      expect(
        1,
        'if the promise resolves then the typoesquat attack message was seen, the promise should not reject in any way'
      ).toBe(1)
    }, 10_000) // About 5s on my machine, will be slow in ci
  })
}
