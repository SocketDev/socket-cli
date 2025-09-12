import path from 'node:path'

import trash from 'trash'
import { afterEach, beforeEach, describe, expect } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { cmdit, spawnNpm, testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

async function setupFixturePackageLocks() {
  const fixtureDirs = ['fixtures/commands/patch']

  for (const d of fixtureDirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await spawn('npm', ['install', '--silent', '--no-audit', '--no-fund'], {
        cwd: path.join(testPath, d),
        stdio: 'ignore',
      })
    } catch {
      // Installation failed, which is fine for testing.
    }
  }
}

async function cleanupPackageLockFiles() {
  const cleanupPaths = [
    'fixtures/commands/patch/package-lock.json',
    'fixtures/commands/patch/node_modules',
  ]
  for (const p of cleanupPaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await trash(path.join(testPath, p))
    } catch {
      // File/directory doesn't exist, which is fine.
    }
  }
}

describe('socket patch', async () => {
  const { binCliPath } = constants

  // No setup/cleanup needed for these tests

  cmdit(
    ['patch', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toContain('Apply CVE patches to dependencies')
      expect(stderr).toContain('`socket patch`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('No .socket directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['patch', '.', '--config', '{"apiToken":"fake-token"}'],
    'should scan for available patches when no node_modules found',
    async cmd => {
      const { code } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/patch'),
      })
      expect(code, 'should exit with code 0 when no packages to patch').toBe(0)
    },
  )

  cmdit(
    ['patch', '.', '--json', '--config', '{"apiToken":"fake-token"}'],
    'should output results in JSON format',
    async cmd => {
      const { code } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/patch'),
      })
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', '.', '--markdown', '--config', '{"apiToken":"fake-token"}'],
    'should output results in markdown format',
    async cmd => {
      const { code } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/patch'),
      })
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      '.',
      '--json',
      '--markdown',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/patch'),
      })
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      '.',
      '-p',
      'pkg:npm/on-headers@1.0.2',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept short flag -p for purl',
    async cmd => {
      const { code } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/patch'),
      })
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  describe('comprehensive patch tests', () => {
    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/on-headers@1.0.2',
        '--json',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle specific PURL with JSON output',
      async cmd => {
        const { code, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(stdout).toBeDefined()
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/on-headers@1.0.2',
        '--markdown',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle specific PURL with markdown output',
      async cmd => {
        const { code, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(stdout).toBeDefined()
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      ['patch', '.', '--config', '{"apiToken":"fake-token"}'],
      'should scan all packages in manifest when no specific PURL given',
      async cmd => {
        const { code, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(stdout).toBeDefined()
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/nonexistent@1.0.0',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle non-existent packages gracefully',
      async cmd => {
        const { code } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(code, 'should exit with code 0 for non-existent packages').toBe(
          0,
        )
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      ['patch', '/nonexistent/path', '--config', '{"apiToken":"fake-token"}'],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('No .socket directory found')
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['patch', '--config', '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'invalid-purl-format',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle invalid PURL formats gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        const output = stdout + stderr
        expect(code, 'should exit with code 0 for invalid PURL').toBe(0)
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/nonexistent-package@999.999.999',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle PURLs for packages not in manifest',
      async cmd => {
        const { code } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(
          code,
          'should exit with code 0 for packages not in manifest',
        ).toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/@scoped/package@1.0.0',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle scoped package PURLs correctly',
      async cmd => {
        const { code } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      ['patch', '--help', '--purl', 'pkg:npm/test@1.0.0', '--config', '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnNpm(binCliPath, cmd)
        expect(stdout).toContain('Apply CVE patches to dependencies')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/on-headers@1.0.2',
        '--purl',
        'pkg:npm/another-package@2.0.0',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle multiple PURL flags',
      async cmd => {
        const { code } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      ['patch', '.', '--config', '{"apiToken":"invalid-format-token"}'],
      'should handle invalid API tokens gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(code, 'should exit with code 0 with invalid token').toBe(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:pypi/python-package@1.0.0',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle non-npm ecosystem PURLs appropriately',
      async cmd => {
        const { code } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        expect(code, 'should exit with code 0').toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/test@',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle PURLs with missing versions',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/patch'),
        })
        const output = stdout + stderr
        expect(code, 'should exit with code 0 for malformed PURL').toBe(0)
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })
})
