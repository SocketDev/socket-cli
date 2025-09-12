import { describe, expect } from 'vitest'

import { cmdit, invokeNpm, testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

describe('socket patch', async () => {
  const { binCliPath } = constants

  cmdit(
    ['patch', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(
        binCliPath,
        cmd,
        {},
        testPath,
      )
      expect(stdout).toContain('Apply CVE patches to dependencies')
      expect(stderr).toContain('`socket patch`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(
        binCliPath,
        cmd,
        {},
        testPath,
      )
      const output = stdout + stderr
      expect(output).toContain('No .socket directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'fixtures/commands/patch',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should scan for available patches when no node_modules found',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd, {}, testPath)
      expect(code, 'should exit with code 0 when no packages to patch').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'fixtures/commands/patch',
      '--json',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should output results in JSON format',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd, {}, testPath)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'fixtures/commands/patch',
      '--markdown',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should output results in markdown format',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd, {}, testPath)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'fixtures/commands/patch',
      '--json',
      '--markdown',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(
        binCliPath,
        cmd,
        {},
        testPath,
      )
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'fixtures/commands/patch',
      '-p',
      'pkg:npm/on-headers@1.0.2',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should accept short flag -p for purl',
    async cmd => {
      const { code } = await invokeNpm(binCliPath, cmd, {}, testPath)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
