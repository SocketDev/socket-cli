import { describe, expect, it } from 'vitest'

import { applyMachineMode } from '../../../../src/utils/spawn/machine-mode.mts'

describe('applyMachineMode', () => {
  describe('universal env', () => {
    it('injects NO_COLOR/FORCE_COLOR/CLICOLOR_FORCE for every tool', () => {
      const result = applyMachineMode({
        args: [],
        tool: 'unknown-tool',
      })
      expect(result.env['NO_COLOR']).toBe('1')
      expect(result.env['FORCE_COLOR']).toBe('0')
      expect(result.env['CLICOLOR_FORCE']).toBe('0')
    })

    it('preserves caller env alongside universal vars', () => {
      const result = applyMachineMode({
        args: [],
        env: { CUSTOM_VAR: 'value' },
        tool: 'npm',
      })
      expect(result.env['CUSTOM_VAR']).toBe('value')
      expect(result.env['NO_COLOR']).toBe('1')
    })
  })

  describe('npm', () => {
    it('forwards --json on JSON-aware subcommands', () => {
      const result = applyMachineMode({
        args: ['--long'],
        subcommand: 'ls',
        tool: 'npm',
      })
      expect(result.args).toContain('--json')
      expect(result.args).toContain('--loglevel=error')
      expect(result.args).toContain('--long')
    })

    it('omits --json on non-JSON subcommands', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'npm',
      })
      expect(result.args).not.toContain('--json')
      expect(result.args).toContain('--loglevel=error')
    })
  })

  describe('pnpm', () => {
    it('uses --reporter=json on supporting subcommands', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'pnpm',
      })
      expect(result.args).toContain('--reporter=json')
    })

    it('uses --reporter=silent as fallback', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'unknown-subcmd',
        tool: 'pnpm',
      })
      expect(result.args).toContain('--reporter=silent')
      expect(result.args).not.toContain('--reporter=json')
    })
  })

  describe('yarn classic', () => {
    it('forwards --json and --silent on install', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'yarn',
      })
      expect(result.args).toContain('--json')
      expect(result.args).toContain('--silent')
    })
  })

  describe('yarn berry', () => {
    it('sets all YARN_ENABLE_* env vars', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'yarn-berry',
      })
      expect(result.env['YARN_ENABLE_PROGRESS_BARS']).toBe('0')
      expect(result.env['YARN_ENABLE_INLINE_BUILDS']).toBe('0')
      expect(result.env['YARN_ENABLE_MESSAGE_NAMES']).toBe('0')
      expect(result.env['YARN_ENABLE_COLORS']).toBe('0')
      expect(result.env['YARN_ENABLE_HYPERLINKS']).toBe('0')
    })

    it('forwards --json on broad subcommand set', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'yarn-berry',
      })
      expect(result.args).toContain('--json')
    })

    it('omits --json on non-JSON subcommands (remove/up/run)', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'remove',
        tool: 'yarn-berry',
      })
      expect(result.args).not.toContain('--json')
    })
  })

  describe('zpm (yarn 6)', () => {
    it('forwards --json on supporting subcommands', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'info',
        tool: 'zpm',
      })
      expect(result.args).toContain('--json')
    })

    it('adds --silent for install', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'install',
        tool: 'zpm',
      })
      expect(result.args).toContain('--silent')
    })

    it('no flags for unsupported subcommands', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'remove',
        tool: 'zpm',
      })
      expect(result.args).not.toContain('--json')
      expect(result.args).not.toContain('--silent')
    })
  })

  describe('vltpkg', () => {
    it('uniformly forwards --view=json to every subcommand', () => {
      expect(
        applyMachineMode({ args: [], subcommand: 'ls', tool: 'vlt' }).args,
      ).toContain('--view=json')
      expect(
        applyMachineMode({
          args: [],
          subcommand: 'query',
          tool: 'vlt',
        }).args,
      ).toContain('--view=json')
      expect(
        applyMachineMode({ args: [], subcommand: 'anything', tool: 'vlt' })
          .args,
      ).toContain('--view=json')
    })
  })

  describe('pip/uv/cargo/gem', () => {
    it('pip gets -q and PIP_NO_COLOR', () => {
      const result = applyMachineMode({ args: [], tool: 'pip' })
      expect(result.args).toContain('-q')
      expect(result.env['PIP_NO_COLOR']).toBe('1')
    })

    it('uv gets --quiet', () => {
      const result = applyMachineMode({ args: [], tool: 'uv' })
      expect(result.args).toContain('--quiet')
    })

    it('cargo gets -q', () => {
      const result = applyMachineMode({ args: [], tool: 'cargo' })
      expect(result.args).toContain('-q')
    })

    it('gem gets --quiet --no-color', () => {
      const result = applyMachineMode({ args: [], tool: 'gem' })
      expect(result.args).toContain('--quiet')
      expect(result.args).toContain('--no-color')
    })
  })

  describe('go', () => {
    it('adds -json for list/test/build', () => {
      expect(
        applyMachineMode({ args: [], subcommand: 'list', tool: 'go' }).args,
      ).toContain('-json')
      expect(
        applyMachineMode({ args: [], subcommand: 'test', tool: 'go' }).args,
      ).toContain('-json')
      expect(
        applyMachineMode({ args: [], subcommand: 'build', tool: 'go' }).args,
      ).toContain('-json')
    })

    it('omits -json for unsupported subcommands', () => {
      const result = applyMachineMode({
        args: [],
        subcommand: 'get',
        tool: 'go',
      })
      expect(result.args).not.toContain('-json')
    })
  })

  describe('unknown tools', () => {
    it('passes args through unchanged', () => {
      const result = applyMachineMode({
        args: ['--foo', 'bar'],
        tool: 'never-heard-of-it',
      })
      expect(result.args).toEqual(['--foo', 'bar'])
    })

    it('still injects universal env vars', () => {
      const result = applyMachineMode({
        args: [],
        tool: 'never-heard-of-it',
      })
      expect(result.env['NO_COLOR']).toBe('1')
    })
  })

  describe('arg ordering', () => {
    it('prepends forwarded flags before caller args', () => {
      const result = applyMachineMode({
        args: ['install', 'lodash'],
        subcommand: 'install',
        tool: 'pnpm',
      })
      const installIdx = result.args.indexOf('install')
      const reporterIdx = result.args.indexOf('--reporter=json')
      expect(reporterIdx).toBeLessThan(installIdx)
    })
  })
})
