/**
 * Integration tests for `socket patch` root command.
 *
 * Tests the patch management root command which forwards to socket-patch v2.0.0+
 * (a standalone Rust binary from GitHub releases).
 *
 * Test Coverage:
 * - Help text display and subcommand listing
 * - Subcommand routing to socket-patch binary
 *
 * Available socket-patch v2.0.0 Commands:
 * - apply: Apply security patches from local manifest
 * - get (alias: download): Get security patches from Socket API
 * - list: List all patches in local manifest
 * - remove: Remove a patch from manifest (replaces old 'rm')
 * - repair (alias: gc): Download missing blobs and clean up
 * - rollback: Rollback patches to restore original files
 * - scan: Scan installed packages for available patches
 * - setup: Configure package.json postinstall scripts
 *
 * Related Files:
 * - src/commands/patch/cmd-patch.mts - Root command that forwards to socket-patch
 */

import path from 'node:path'

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

describe('socket patch', async () => {
  describe('help display', () => {
    cmdit(
      ['patch', FLAG_HELP, FLAG_CONFIG, '{}'],
      `should support ${FLAG_HELP}`,
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        // Socket CLI help shows: "Manage CVE patches for dependencies"
        expect(stdout).toContain('Manage CVE patches for dependencies')
        expect(stderr).toContain('`socket patch`')
        expect(code, 'explicit help should exit with code 0').toBe(0)
      },
    )

    cmdit(
      ['patch', FLAG_CONFIG, '{}'],
      'should show help when no arguments provided',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        // Without subcommand, shows Socket CLI help.
        expect(stdout).toContain('Manage CVE patches for dependencies')
        expect(code).toBe(0)
      },
    )
  })

  describe('subcommand forwarding', () => {
    cmdit(
      ['patch', 'scan', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should forward scan subcommand to socket-patch',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        // socket-patch v2.0.0 scans for packages. Without node_modules it shows "No packages found".
        expect(output).toMatch(
          /No packages found|Found \d+ packages|patches available/i,
        )
        // socket-patch scan returns 0 even when no packages found.
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['patch', 'list', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should forward list subcommand to socket-patch',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        // socket-patch v2.0.0 lists patches from manifest. May show patches or "no patches".
        expect(output).toMatch(/patches|manifest|No .socket directory/i)
        // Exit code depends on whether manifest exists.
        expect(typeof code).toBe('number')
      },
    )

    cmdit(
      ['patch', 'apply', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should forward apply subcommand to socket-patch',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        // socket-patch v2.0.0 applies patches. Without manifest, shows error.
        expect(output).toMatch(/Applied|No patches|manifest|nothing to apply/i)
        // Exit code depends on state.
        expect(typeof code).toBe('number')
      },
    )
  })

  describe('socket-patch binary help', () => {
    cmdit(
      ['patch', 'scan', '--help', FLAG_CONFIG, '{}'],
      'should show socket-patch scan help',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        // socket-patch shows its own help for subcommands.
        expect(stdout).toContain('Scan')
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['patch', 'get', '--help', FLAG_CONFIG, '{}'],
      'should show socket-patch get help',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        // socket-patch shows its own help for get command.
        expect(stdout).toContain('Get')
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['patch', 'remove', '--help', FLAG_CONFIG, '{}'],
      'should show socket-patch remove help',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        // socket-patch shows its own help for remove command.
        expect(stdout).toContain('Remove')
        expect(code).toBe(0)
      },
    )
  })
})
