import { describe, expect } from 'vitest'

import { cmdit, invokeNpm } from '../../../test/utils.mts'
import constants from '../../constants.mts'

describe('socket patch', async () => {
  const { binCliPath } = constants

  cmdit(
    ['patch', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toContain('Apply CVE patches to dependencies')
      expect(stderr).toContain('`socket patch`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('No .socket directory found')
      expect(output).toContain('Error:')
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle patch fixture with on-headers vulnerability',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(code, 'should exit with code 0 for valid patch fixture').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'pkg:npm/on-headers@1.0.2',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept --purl flag for on-headers',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'pkg:npm/on-headers@1.0.2,pkg:npm/lodash@4.17.20',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept multiple PURLs as comma-separated values',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'pkg:npm/on-headers@1.0.2',
      '--purl',
      'pkg:npm/lodash@4.17.20',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept multiple --purl flags',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--json',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should output results in JSON format',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--markdown',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should output results in markdown format',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--json',
      '--markdown',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'invalid-purl',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle invalid PURL gracefully',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0 even with invalid PURL').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'pkg:npm/@types/lodash@4.14.165',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle scoped package PURL',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '-p',
      'pkg:npm/on-headers@1.0.2',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept short flag -p for purl',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'test/fixtures/commands/patch',
      '--purl',
      'pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.9.8',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle non-npm ecosystem PURL',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
