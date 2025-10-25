import { promises as fs } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect } from 'vitest'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

async function cleanupNodeModules() {
  // Clean up node_modules from all package manager directories.
  await Promise.all([
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

describe('socket patch', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
  })

  cmdit(
    ['patch', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Apply CVE patches to dependencies')
      expect(stderr).toContain('`socket patch`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // Command now falls back to discovery when no .socket dir exists.
      expect(output).toContain('No node_modules directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['patch', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should scan for available patches when no node_modules found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Discovery requires node_modules, so should error when it's missing.
      expect(output).toContain('No node_modules directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['patch', '.', '--json', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should require node_modules for discovery (JSON output)',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('No node_modules directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['patch', '.', '--markdown', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should require node_modules for discovery (markdown output)',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('No node_modules directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      '.',
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
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
    [
      'patch',
      '.',
      '-p',
      'pkg:npm/on-headers@1.0.2',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should require node_modules for discovery (short flag)',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('No node_modules directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
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
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for PURL discovery (JSON)',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/on-headers@1.0.2',
        '--markdown',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for PURL discovery (markdown)',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      ['patch', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should require node_modules for manifest scanning',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/nonexistent@1.0.0',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules even for non-existent packages',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      ['patch', '/nonexistent/path', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        // Patch discover falls back to directory scan, which needs node_modules.
        expect(output).toContain('No node_modules directory found')
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['patch', FLAG_CONFIG, '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for invalid PURL formats',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/nonexistent-package@999.999.999',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for packages not in manifest',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/@scoped/package@1.0.0',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for scoped packages',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      ['patch', FLAG_HELP, '--purl', 'pkg:npm/test@1.0.0', FLAG_CONFIG, '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
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
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for multiple PURLs',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      ['patch', '.', FLAG_CONFIG, '{"apiToken":"invalid-format-token"}'],
      'should require node_modules even with invalid API tokens',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:pypi/python-package@1.0.0',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for non-npm ecosystem PURLs',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'patch',
        '.',
        '--purl',
        'pkg:npm/test@',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should require node_modules for PURLs with missing versions',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })
        const output = stdout + stderr
        expect(output).toContain('No node_modules directory found')
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })
})
