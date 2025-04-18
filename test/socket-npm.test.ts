import { describe, expect, it } from 'vitest'

const path = require('node:path')
const process = require('node:process')

const { spawn, spawnSync } = require('@socketsecurity/registry/lib/spawn')

const constants = require('../dist/constants.js')

const { CLI, NODE_MODULES, NPM } = constants

const testPath = __dirname
const npmFixturesPath = path.join(testPath, 'socket-npm-fixtures')

// These aliases are defined in package.json.
for (const npmDir of ['npm8', 'npm9', 'npm10', 'npm11']) {
  if (process.env.CI) {
    // Skip this test in CI.
    describe('skipme', () => it('should skip', () => expect(true).toBe(true)))
    continue
  }
  const npmPath = path.join(npmFixturesPath, npmDir)
  const npmBinPath = path.join(npmPath, NODE_MODULES, '.bin')

  describe(`Socket npm wrapper for ${npmDir}`, () => {
    spawnSync(NPM, ['install', '--silent'], {
      cwd: npmPath,
      stdio: 'ignore'
    })

    // Lazily access constants.rootBinPath.
    const entryPath = path.join(constants['rootBinPath'], `${CLI}.js`)

    it(
      'should bail on new typosquat',
      {
        // About 5s on my machine. Will be slow in CI. Extend if too flaky.
        timeout: 30_000
      },
      async () => {
        const result = await new Promise<string>((resolve, reject) => {
          const spawnPromise = spawn(
            // Lazily access constants.execPath.
            constants.execPath,
            [entryPath, NPM, 'install', 'bowserify', '--no-audit', '--no-fund'],
            {
              cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
              env: {
                PATH: `${npmBinPath}:${process.env.PATH}`
              }
            }
          )
          spawnPromise.process.stdout.on('data', () => {
            reject(
              new Error(
                'It seems npm ran anyways so the test failed to invoke socket'
              )
            )
          })
          spawnPromise.catch((e: any) => {
            spawnPromise.process.kill('SIGINT')
            if (e?.['stderr'].includes('typosquat')) {
              resolve('OK')
            } else {
              reject(e)
            }
          })
        })

        expect(
          result,
          'if the promise resolves then the typo-squat attack message was seen, the promise should not reject in any way'
        ).toBe('OK')
      }
    )
  })
}
