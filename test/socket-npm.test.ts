import { describe, expect, it } from 'vitest'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const process = require('node:process')

const spawn = require('@npmcli/promise-spawn')

const constants = require('../dist/constants.js')

const { CLI, NODE_MODULES, NPM, abortSignal } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
for (const npmDir of ['npm8', 'npm10']) {
  if (process.env['CI']) {
    // Skip this test in CI.
    describe('skipme', () => it('should skip', () => expect(true).toBe(true)))
    continue
  }
  const npmPath = path.join(npmFixturesPath, npmDir)
  const npmBinPath = path.join(npmPath, NODE_MODULES, '.bin')

  spawnSync(NPM, ['install', '--silent'], {
    cwd: npmPath,
    signal: abortSignal,
    stdio: 'ignore'
  })

  describe(`Socket npm wrapper for ${npmDir}`, () => {
    // Lazily access constants.rootBinPath.
    const entryPath = path.join(constants['rootBinPath'], `${CLI}.js`)

    it('should bail on new typosquat', async () => {
      const result = await new Promise<string>((resolve, reject) => {
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
        spawnPromise.process.stdout.on('data', (buffer: Buffer) => {
          // console.log(buffer.toString('utf8'))
          // changed 13 packages, and audited 176 packages in 3s
          if (
            /changed .* packages, and audited .* packages in/.test(
              buffer.toString('utf8')
            )
          ) {
            reject(
              new Error(
                'It seems npm ran anyways so the test failed to invoke socket'
              )
            )
          }
        })

        spawnPromise.process.stderr.on('data', (buffer: Buffer) => {
          // console.error(buffer.toString('utf8'))
          if (buffer.toString().includes('Possible typosquat attack')) {
            resolve('OK')
            spawnPromise.process.kill('SIGINT')
          }
        })

        spawnPromise.catch(() => {
          spawnPromise.process.kill('SIGINT')
          reject(new Error('Received a SIGINT'))
        })
      })

      expect(
        result,
        'if the promise resolves then the typo-squat attack message was seen, the promise should not reject in any way'
      ).toBe('OK')
    }, 30_000) // About 5s on my machine, will be slow in ci, extend if too flaky
  })
}
