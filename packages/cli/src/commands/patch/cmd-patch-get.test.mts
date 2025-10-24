import { existsSync, promises as fs } from 'node:fs'
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

async function cleanupPatchesDir() {
  // Clean up generated patches directories.
  await Promise.all([
    fs.rm(path.join(pnpmFixtureDir, 'patches'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(process.cwd(), 'patches'), {
      force: true,
      recursive: true,
    }),
  ])
}

describe('socket patch get', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
    await cleanupPatchesDir()
  })

  cmdit(
    ['patch', 'get', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Download patch files to local directory')
      expect(stderr).toContain('`socket patch get`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'get', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should show error when PURL is not provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('PURL is required')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('No .socket directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/nonexistent@1.0.0',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when patch not found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Patch not found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should download patch files to default directory',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Copied 1 patch file')
      expect(code, 'should exit with code 0').toBe(0)

      // Verify the file was created.
      const expectedDir = path.join(
        pnpmFixtureDir,
        'patches',
        'pkg_npm_on-headers_1.0.2',
      )
      const expectedFile = path.join(expectedDir, 'index.js')
      expect(existsSync(expectedFile), 'patch file should exist').toBe(true)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--output',
      path.join(pnpmFixtureDir, 'custom-patches'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should download patch files to custom output directory',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Copied 1 patch file')
      expect(stdout).toContain('custom-patches')
      expect(code, 'should exit with code 0').toBe(0)

      // Verify the file was created in custom directory.
      const expectedFile = path.join(
        pnpmFixtureDir,
        'custom-patches',
        'index.js',
      )
      expect(existsSync(expectedFile), 'patch file should exist').toBe(true)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch get result in JSON format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      const json = JSON.parse(stdout)
      expect(json.purl).toBe('pkg:npm/on-headers@1.0.2')
      expect(json.files).toBeDefined()
      expect(Array.isArray(json.files)).toBe(true)
      expect(json.files).toContain('index.js')
      expect(json.outputDir).toBeDefined()
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch get result in markdown format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('## Patch Files Retrieved')
      expect(stdout).toContain('**PURL**: pkg:npm/on-headers@1.0.2')
      expect(stdout).toContain('**Output Directory**')
      expect(stdout).toContain('**Files**: 1')
      expect(stdout).toContain('- index.js')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )
})
