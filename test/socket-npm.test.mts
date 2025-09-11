import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn, spawnSync } from '@socketsecurity/registry/lib/spawn'

import { npmFixturesPath } from './utils.mts'
import constants from '../src/constants.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const testPath = __dirname

// These aliases are defined in package.json.
for (const npmDir of ['npm9', 'npm10', 'npm11']) {
  if (constants.ENV.CI) {
    // Skip this test in CI.
    describe('skipme', () => it('should skip', () => expect(true).toBe(true)))
    continue
  }
  const npmPath = path.join(npmFixturesPath, npmDir)
  const npmBinPath = path.join(npmPath, 'node_modules/.bin')

  describe(`Socket npm wrapper for ${npmDir}`, () => {
    const usDebug = isDebug('stdio')
    spawnSync('npm', ['install', ...(usDebug ? [] : ['--silent'])], {
      cwd: npmPath,
      stdio: usDebug ? 'inherit' : 'ignore',
    })

    const entryPath = path.join(constants.binPath, 'cli.js')

    it(
      'should bail on new typosquat',
      {
        // About 5s on my machine. Will be slow in CI. Extend if too flaky.
        timeout: 30_000,
      },
      async () => {
        const result = await new Promise<string>((resolve, reject) => {
          const spawnPromise = spawn(
            constants.execPath,
            [
              entryPath,
              'npm',
              'install',
              '--no-audit',
              '--no-fund',
              'bowserify',
            ],
            {
              cwd: path.join(npmFixturesPath, 'lacking-typosquat'),
              env: {
                ...process.env,
                ...constants.processEnv,
                PATH: `${npmBinPath}:${constants.ENV.PATH}`,
              },
            },
          )

          spawnPromise.process.stdout!.on('data', () => {
            reject(
              new Error(
                'It seems npm ran anyways so the test failed to invoke socket',
              ),
            )
          })

          spawnPromise.catch((e: unknown) => {
            spawnPromise.process.kill('SIGINT')
            if (
              e?.['stderr'].includes('typosquat') ||
              // Sometimes our token quota is exceeded.
              e?.['stderr'].includes('Too Many Requests') ||
              // Sometimes we're unauthorized.
              e?.['stderr'].includes('Unauthorized')
            ) {
              resolve('OK')
            } else {
              reject(e)
            }
          })
        })

        expect(
          result,
          'if the promise resolves then the typo-squat attack message was seen, the promise should not reject in any way',
        ).toBe('OK')
      },
    )
  })
}
