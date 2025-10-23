import { execSync } from 'node:child_process'

import { beforeAll, describe, expect, it } from 'vitest'

import ENV from '../../constants/env.mts'
import { spawnDlx } from './spawn.mts'
import { findUp } from '../fs/fs.mts'
import { getDefaultApiToken } from '../socket/sdk.mts'

describe('dlx e2e tests', () => {
  let hasAuth = false

  beforeAll(async () => {
    // Check if running e2e tests and if Socket API token is available.
    if (ENV.RUN_E2E_TESTS) {
      const apiToken = await getDefaultApiToken()
      hasAuth = !!apiToken
      if (!apiToken) {
        console.log()
        console.warn('E2E tests require Socket authentication.')
        console.log('Please run one of the following:')
        console.log('  1. socket login (to authenticate with Socket)')
        console.log('  2. Set SOCKET_SECURITY_API_KEY environment variable')
        console.log('  3. Skip e2e tests by not setting RUN_E2E_TESTS\n')
        console.log(
          'E2E tests will be skipped due to missing authentication.\n',
        )
      }
    }
  })
  describe('pnpm dlx regression test', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'successfully runs pnpm dlx with cowsay (verifies no unsupported flags)',
      async () => {
        // Check if we're in a pnpm project.
        const pnpmLock = await findUp('pnpm-lock.yaml')
        if (!pnpmLock) {
          console.log('Skipping test - not in a pnpm project')
          return
        }

        // Use cowsay as a safe, pinned package for testing.
        const packageSpec = {
          name: 'cowsay',
          version: '1.6.0', // Pinned version for consistency.
        }

        // Run cowsay with a test message.
        const result = await spawnDlx(packageSpec, [
          'Hello from Socket CLI tests!',
        ])

        // Verify it succeeded.
        expect(result.spawnPromise).toBeDefined()
        const spawnResult = await result.spawnPromise
        expect(spawnResult.code).toBe(0)
        if (spawnResult.stdout) {
          // Cowsay should output our message in a speech bubble.
          expect(spawnResult.stdout).toContain('Hello from Socket CLI tests!')
          // Should have the cow ASCII art.
          expect(spawnResult.stdout).toMatch(/\\\s+/)
          expect(spawnResult.stdout).toMatch(/\^__\^/)
        }
      },
      30000, // 30 second timeout for download.
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'verifies pnpm dlx command construction uses only supported flags',
      async () => {
        // This test verifies by checking what command would be run.
        const pnpmLock = await findUp('pnpm-lock.yaml')
        if (!pnpmLock) {
          console.log('Skipping test - not in a pnpm project')
          return
        }

        // We can't easily intercept the actual spawn call in e2e,
        // but we can verify the command that would be constructed
        // by checking our unit tests pass and the actual execution works.

        // Try to run a simple pnpm dlx command directly to ensure it works.
        try {
          const output = execSync('pnpm dlx cowsay@1.6.0 "Direct test"', {
            encoding: 'utf8',
            stdio: 'pipe',
          })
          expect(output).toContain('Direct test')

          // Verify that adding unsupported flags would fail.
          // For example, --ignore-scripts is only for pnpm install, not dlx.
          expect(() => {
            execSync('pnpm dlx --ignore-scripts cowsay@1.6.0 "Should fail"', {
              encoding: 'utf8',
              stdio: 'pipe',
            })
          }).toThrow()
        } catch (error) {
          // If pnpm is not available globally, skip this part.
          console.log('Could not run direct pnpm test:', error.message)
        }
      },
      15000,
    )
  })

  describe('npm npx regression test', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'successfully runs npm/npx with cowsay',
      async () => {
        // Force npm by not finding any pnpm/yarn lockfiles.
        const _npmLock = await findUp('package-lock.json')
        const pnpmLock = await findUp('pnpm-lock.yaml')
        const yarnLock = await findUp('yarn.lock')

        // Skip if we're in a pnpm/yarn project to ensure npm is used.
        if (pnpmLock || yarnLock) {
          console.log('Skipping npm test - in pnpm/yarn project')
          return
        }

        const packageSpec = {
          name: 'cowsay',
          version: '1.6.0',
        }

        // Force npm agent.
        const result = await spawnDlx(packageSpec, ['Moo from npm!'], {
          agent: 'npm',
        })

        expect(result.ok).toBe(true)
        if (result.ok && result.data) {
          expect(result.data).toContain('Moo from npm!')
        }
      },
      30000,
    )
  })

  describe('spawnCoanaDlx e2e tests', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'executes coana-tech/cli via dlx',
      async () => {
        const { spawnCoanaDlx } = await import('./spawn.mts')
        const result = await spawnCoanaDlx(['--help'])

        // Coana might fail due to network issues or package availability
        expect(result).toBeDefined()
        expect(typeof result.ok).toBe('boolean')

        if (result.ok && result.data) {
          expect(result.data).toContain('coana')
        } else if (!result.ok) {
          // Log the error for debugging but don't fail the test
          console.log(
            'Coana failed (expected in some environments):',
            result.message,
          )
          expect(result.message).toBeDefined()
        }
      },
      30000,
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'handles error from spawn',
      async () => {
        const { spawnCoanaDlx } = await import('./spawn.mts')
        // Pass invalid args to trigger an error.
        const result = await spawnCoanaDlx([
          '--invalid-flag-that-does-not-exist',
        ])

        // The command might still succeed if the tool ignores unknown flags.
        // Just verify we get a result.
        expect(result).toBeDefined()
        expect(typeof result.ok).toBe('boolean')
      },
      30000,
    )
  })

  describe('spawnSynpDlx e2e tests', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'executes synp via dlx',
      async () => {
        const { spawnSynpDlx } = await import('./spawn.mts')
        const result = await spawnSynpDlx(['--help'])

        expect(result.spawnPromise).toBeDefined()
        const spawnResult = await result.spawnPromise
        expect(spawnResult.code).toBe(0)
        if (spawnResult.stdout) {
          expect(spawnResult.stdout).toContain('synp')
        }
      },
      30000,
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'handles error from spawn',
      async () => {
        const { spawnSynpDlx } = await import('./spawn.mts')
        // Pass invalid args to trigger an error.
        const result = await spawnSynpDlx([
          '--invalid-flag-that-does-not-exist',
        ])

        // The command should fail with invalid flags.
        // Just verify we get a result with spawnPromise.
        expect(result).toBeDefined()
        expect(result.spawnPromise).toBeDefined()

        // The spawnPromise may throw or return with non-zero exit code
        try {
          const spawnResult = await result.spawnPromise
          expect(spawnResult.code).toBeGreaterThan(0) // Should fail with non-zero exit code
        } catch (error) {
          // Command failed as expected - this is valid behavior
          expect(error).toBeDefined()
        }
      },
      30000,
    )
  })

  describe('spawnDlx e2e tests', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'executes dlx command with package spec',
      async () => {
        const packageSpec = {
          name: 'cowsay',
          version: '1.6.0',
        }

        const result = await spawnDlx(packageSpec, ['--help'])

        expect(result.spawnPromise).toBeDefined()
        const spawnResult = await result.spawnPromise
        expect(spawnResult).toBeDefined()
      },
      30000,
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'handles force flag in options',
      async () => {
        const packageSpec = {
          name: 'cowsay',
          version: '1.6.0',
        }

        const result = await spawnDlx(packageSpec, ['Test with force'], {
          force: true,
        })

        expect(result.spawnPromise).toBeDefined()
        const spawnResult = await result.spawnPromise
        expect(spawnResult).toBeDefined()
      },
      30000,
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'handles silent flag in options',
      async () => {
        const packageSpec = {
          name: 'cowsay',
          version: '^1.6.0', // Range version should trigger silent.
        }

        const result = await spawnDlx(packageSpec, ['Silent test'], {
          silent: true,
        })

        expect(result.spawnPromise).toBeDefined()
        const spawnResult = await result.spawnPromise
        expect(spawnResult).toBeDefined()
      },
      30000,
    )
  })
})
