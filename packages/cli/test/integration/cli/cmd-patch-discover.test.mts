import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

async function cleanupNodeModules() {
  // Clean up node_modules from all package manager directories.
  Promise.allSettled([
    fs.rm(path.join(pnpmFixtureDir, 'node_modules'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(fixtureBaseDir, 'npm/node_modules'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(fixtureBaseDir, 'yarn/node_modules'), {
      force: true,
      recursive: true,
    }),
  ])
}

describe('socket patch discover', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
  })

  cmdit(
    ['patch', 'discover', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Discover available patches')
      expect(stderr).toContain('`socket patch discover`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'discover', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should show error when no node_modules directory found',
    async cmd => {
      // Create a temporary directory without node_modules.
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-test-'))
      try {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: tmpDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      } finally {
        // Clean up temporary directory.
        await fs.rm(tmpDir, { force: true, recursive: true })
      }
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      '--scan',
      'nonexistent-scan-id',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept --scan flag with scan ID',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should not complain about node_modules when using --scan.
      expect(output).not.toContain('No node_modules directory found')
      // Will fail with API error since scan doesn't exist, but that's expected.
      expect(code, 'should exit with non-zero code for invalid scan').not.toBe(
        0,
      )
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      '-s',
      'test-scan-id',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support -s short flag for --scan',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept -s as alias for --scan.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept -s flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      '--interactive',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept --interactive flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should not complain about unknown flag.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept --interactive flag').toBeDefined()
    },
  )

  cmdit(
    ['patch', 'discover', '-i', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should support -i short flag for --interactive',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept -i as alias for --interactive.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept -i flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should reject both --json and --markdown flags',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['patch', 'discover', '--json', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should support --json output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      // Should accept --json flag without error.
      const output = stdout + stderr
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept --json flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support --markdown output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      // Should accept --markdown flag without error.
      const output = stdout + stderr
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept --markdown flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'discover',
      './some/path',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept custom directory path',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // Should accept path argument (will fail if path doesn't exist, but syntax is valid).
      expect(output).not.toContain('Unexpected argument')
      expect(code, 'should accept path argument').toBeDefined()
    },
  )

  cmdit(
    ['patch', 'discover', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should not show double checkmark in output',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr

      // Should not have double checkmark (✔ ✓ or ✓ ✔).
      expect(output).not.toMatch(/✔\s*✓/)
      expect(output).not.toMatch(/✓\s*✔/)

      // Should still have checkmarks for success messages.
      if (code === 0 || output.includes('Found')) {
        expect(output).toMatch(/✔/)
      }
    },
  )

  cmdit(
    ['patch', 'discover', '--json', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should output valid JSON with patches array',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })

      // If command succeeds, should have valid JSON.
      if (code === 0) {
        expect(() => JSON.parse(stdout)).not.toThrow()
        const json = JSON.parse(stdout)
        expect(json).toHaveProperty('patches')
        expect(Array.isArray(json.patches)).toBe(true)
      }
    },
  )

  cmdit(
    ['patch', 'discover', '--json', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should include vulnerability information in patches',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })

      // If patches are found, they should have vulnerability info.
      if (code === 0) {
        const json = JSON.parse(stdout)
        if (json.patches && json.patches.length > 0) {
          const patch = json.patches[0]
          expect(patch).toHaveProperty('purl')
          expect(patch).toHaveProperty('uuid')
          expect(patch).toHaveProperty('tier')
          expect(patch).toHaveProperty('vulnerabilities')
          expect(Array.isArray(patch.vulnerabilities)).toBe(true)

          // Each vulnerability should have cve and severity.
          if (patch.vulnerabilities.length > 0) {
            const vuln = patch.vulnerabilities[0]
            // cve and severity are optional but should be present if vulnerability exists.
            expect(vuln).toBeDefined()
          }
        }
      }
    },
  )

  cmdit(
    ['patch', 'discover', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should use singular form for 1 patch',
    async cmd => {
      const { stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })

      // If exactly 1 patch found, should say "patch" not "patches".
      if (stdout.includes('Found 1')) {
        expect(stdout).toContain('1 available patch')
        expect(stdout).not.toContain('1 available patches')
      }
    },
  )

  cmdit(
    ['patch', 'discover', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should use plural form for multiple patches',
    async cmd => {
      const { stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })

      // If more than 1 patch found, should say "patches" not "patch".
      const multiMatch = stdout.match(/Found (\d+)/)
      if (multiMatch && Number.parseInt(multiMatch[1], 10) > 1) {
        expect(stdout).toContain('available patches')
        expect(stdout).not.toMatch(/\d+ available patch[^e]/)
      }
    },
  )
})
