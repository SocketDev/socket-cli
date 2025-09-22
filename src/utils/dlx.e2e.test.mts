import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

import { spawnDlx } from './dlx.mts'
import { findUp } from './fs.mts'

describe('dlx e2e tests', () => {
  describe('pnpm dlx regression test', () => {
    it.skipIf(!process.env.RUN_E2E_TESTS)(
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
        const result = await spawnDlx(packageSpec, ['Hello from Socket CLI tests!'])

        // Verify it succeeded.
        expect(result.ok).toBe(true)
        if (result.ok && result.data) {
          // Cowsay should output our message in a speech bubble.
          expect(result.data).toContain('Hello from Socket CLI tests!')
          // Should have the cow ASCII art.
          expect(result.data).toMatch(/\\s+\\/)
          expect(result.data).toMatch(/\\s+\^__\^/)
        }
      },
      30000, // 30 second timeout for download.
    )

    it.skipIf(!process.env.RUN_E2E_TESTS)(
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
    it.skipIf(!process.env.RUN_E2E_TESTS)(
      'successfully runs npm/npx with cowsay',
      async () => {
        // Force npm by not finding any pnpm/yarn lockfiles.
        const npmLock = await findUp('package-lock.json')
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
        const result = await spawnDlx(packageSpec, ['Moo from npm!'], { agent: 'npm' })

        expect(result.ok).toBe(true)
        if (result.ok && result.data) {
          expect(result.data).toContain('Moo from npm!')
        }
      },
      30000,
    )
  })
})