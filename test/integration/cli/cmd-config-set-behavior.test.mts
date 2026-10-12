import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import {
  cliPath,
  configFilePath,
  createTemporaryHome,
  factoryFixturePath,
  runChild,
  runChildInHome,
  syntheticApiToken,
  writePersistedConfig,
} from './config-command-test-helpers.mts'
import { FLAG_DRY_RUN, FLAG_JSON } from '../../../src/constants/cli.mts'
import {
  CMD_NAME,
  cmdConfigSet,
} from '../../../src/command/config/cmd-config-set.mts'
import { createConfigCommand } from '../../../src/command/config/config-command-factory.mts'
import { handleConfigSet } from '../../../src/command/config/handle-config-set.mts'
describe('config command metadata', () => {
  it('exposes the set command metadata', () => {
    expect(CMD_NAME).toBe('set')
    expect(cmdConfigSet.description).toBe(
      'Update the value of a local CLI config item',
    )
    expect(cmdConfigSet.hidden).toBe(false)
  })

  it('constructs a command with the real set handler', () => {
    const command = createConfigCommand({
      commandName: 'set',
      description: 'Set a config value',
      handler: handleConfigSet,
      helpDescription: 'Updates a config key.',
      helpExamples: ['defaultOrg example-org'],
      helpUsage: '<key> <value>',
      needsValue: true,
    })

    expect(command.description).toBe('Set a config value')
    expect(command.hidden).toBe(false)
    expect(typeof command.run).toBe('function')
  })
})

describe('config command behavior', () => {
  it('persists supported values and joins remaining arguments', async () => {
    const home = createTemporaryHome()
    const cases: Array<{
      key: string
      valueArguments: readonly string[]
      expectedValue: string
    }> = [
      {
        key: 'apiBaseUrl',
        valueArguments: ['https://api.example.test/v1?x=one&y=two'],
        expectedValue: 'https://api.example.test/v1?x=one&y=two',
      },
      {
        key: 'apiProxy',
        valueArguments: ['https://proxy.example.test:8443/path'],
        expectedValue: 'https://proxy.example.test:8443/path',
      },
      {
        key: 'defaultOrg',
        valueArguments: ['12345678'],
        expectedValue: '12345678',
      },
      {
        key: 'org',
        valueArguments: ['alias-org'],
        expectedValue: 'alias-org',
      },
      {
        key: 'apiToken',
        valueArguments: [syntheticApiToken],
        expectedValue: syntheticApiToken,
      },
      {
        key: 'defaultOrg',
        valueArguments: ['joined', 'value', 'with', 'spaces'],
        expectedValue: 'joined value with spaces',
      },
    ]

    for (const { key, valueArguments, expectedValue } of cases) {
      const result = await runChildInHome(
        cliPath,
        ['config', 'set', key, ...valueArguments],
        home,
      )
      expect(result.code, result.exitDiagnostic).toBe(0)
      expect(result.config?.[key === 'org' ? 'defaultOrg' : key]).toBe(
        expectedValue,
      )
      expect(result.outputContainsRetiredToken).toBe(false)
      expect(result.outputContainsSyntheticToken).toBe(false)
    }
  })

  it('persists a 1000-character value through the source config command', async () => {
    const value = 'synthetic-config-value-'.repeat(42).padEnd(1000, 'x')
    expect(value).toHaveLength(1000)
    const home = createTemporaryHome()
    const argsPath = path.join(home, 'config-command-args.json')
    writeFileSync(argsPath, JSON.stringify(['defaultOrg', value]))
    const result = await runChildInHome(
      factoryFixturePath,
      ['file', argsPath],
      home,
    )

    expect(result.code, result.exitDiagnostic).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.config?.['defaultOrg']).toBe(value)
    expect(result.outputContainsRetiredToken).toBe(false)
    expect(result.outputContainsSyntheticToken).toBe(false)
  })

  it('rejects invalid input without changing config bytes', async () => {
    const home = createTemporaryHome()
    const originalBytes = writePersistedConfig(home, {
      defaultOrg: 'preserved-org',
      apiToken: 'sktsec_cli_existing_abc123',
    })
    const invalidArguments: ReadonlyArray<readonly string[]> = [
      ['config', 'set', 'unknownKey', 'value'],
      ['config', 'set', ''],
      ['config', 'set'],
      ['config', 'set', 'defaultOrg', ''],
      ['config', 'set', '--json', '--markdown', 'defaultOrg', 'value'],
    ]

    for (
      let index = 0, { length } = invalidArguments;
      index < length;
      index += 1
    ) {
      const args = invalidArguments[index]
      if (!args) {
        throw new Error('Expected invalid arguments at a valid index')
      }
      const result = await runChildInHome(cliPath, args, home)
      expect(result.code, result.exitDiagnostic).toBe(2)
      expect(result.output).toContain('Input error')
      const currentBytes = readFileSync(configFilePath(home))
      expect(currentBytes.equals(originalBytes)).toBe(true)
    }
  })

  it('renders text, JSON, and Markdown success output', async () => {
    const textResult = await runChild(cliPath, [
      'config',
      'set',
      'defaultOrg',
      'text-org',
    ])
    expect(textResult.code).toBe(0)
    expect(textResult.output).toContain('OK')
    expect(textResult.config?.['defaultOrg']).toBe('text-org')

    const jsonResult = await runChild(cliPath, [
      'config',
      'set',
      '--json',
      'defaultOrg',
      'json-org',
    ])
    const jsonOutput: unknown = JSON.parse(jsonResult.stdout.trim())
    expect(jsonResult.code).toBe(0)
    expect(isPlainObject(jsonOutput) && jsonOutput['ok'] === true).toBe(true)
    expect(jsonResult.config?.['defaultOrg']).toBe('json-org')

    const markdownResult = await runChild(cliPath, [
      'config',
      'set',
      '--markdown',
      'defaultOrg',
      'markdown-org',
    ])
    expect(markdownResult.code).toBe(0)
    expect(markdownResult.output).toContain('Update config')
    expect(markdownResult.config?.['defaultOrg']).toBe('markdown-org')
  })

  it('keeps dry-run set and unset previews from writing files', async () => {
    const setResult = await runChild(cliPath, [
      'config',
      'set',
      FLAG_DRY_RUN,
      'defaultOrg',
      'example-org',
    ])
    expect(setResult.code).toBe(0)
    expect(setResult.outputHasDryRunPreview).toBe(true)
    expect(setResult.output).toContain(
      path.join(setResult.home, '.config', 'socket', 'config.json'),
    )
    expect(setResult.configFileExists).toBe(false)

    const home = createTemporaryHome()
    const originalBytes = writePersistedConfig(home, {
      defaultOrg: 'preserved-org',
    })
    const unsetResult = await runChildInHome(
      cliPath,
      ['config', 'unset', FLAG_DRY_RUN, 'defaultOrg'],
      home,
    )
    expect(unsetResult.code).toBe(0)
    expect(unsetResult.output).toContain('Would unset config value')
    expect(readFileSync(configFilePath(home)).equals(originalBytes)).toBe(true)
  })

  it('handles dry-run when HOME is missing', async () => {
    const home = createTemporaryHome()
    const result = await runChildInHome(
      cliPath,
      ['config', 'set', FLAG_DRY_RUN, 'defaultOrg', 'example-org'],
      home,
      undefined,
      false,
    )

    expect(result.code, result.exitDiagnostic).toBe(0)
    expect(result.outputHasDryRunPreview).toBe(true)
    expect(result.output).toContain(
      path.join(process.env['HOME'] ?? '', '.config', 'socket', 'config.json'),
    )
    expect(result.configFileExists).toBe(false)
  })

  it('parses frozen readonly argv in the real factory fixture', async () => {
    const result = await runChild(factoryFixturePath, [
      'frozen',
      'defaultOrg',
      'frozen-argv-org',
    ])

    expect(result.code, result.exitDiagnostic).toBe(0)
    expect(result.config?.['defaultOrg']).toBe('frozen-argv-org')
  })

  it('rejects a flag-like value without changing config bytes', async () => {
    const home = createTemporaryHome()
    const originalBytes = writePersistedConfig(home, {
      defaultOrg: 'preserved-org',
    })
    const result = await runChildInHome(
      cliPath,
      ['config', 'set', 'defaultOrg', '--not-a-flag'],
      home,
    )

    expect(result.code).toBe(2)
    expect(result.output).toContain('Input error')
    expect(readFileSync(configFilePath(home)).equals(originalBytes)).toBe(true)
  })

  it('runs factory validation, help, and unset behavior', async () => {
    const rejectedHome = createTemporaryHome()
    const originalBytes = writePersistedConfig(rejectedHome, {
      defaultOrg: 'preserved-org',
    })
    const rejected = await runChildInHome(
      factoryFixturePath,
      ['set', '--fixture', 'reject', 'defaultOrg', 'reject-me'],
      rejectedHome,
    )
    expect(rejected.code, rejected.exitDiagnostic).toBe(2)
    expect(rejected.output).toContain('Fixture validation rejected')
    const rejectedBytes = readFileSync(configFilePath(rejectedHome))
    expect(rejectedBytes.equals(originalBytes)).toBe(true)

    const help = await runChild(factoryFixturePath, ['set', '--help'])
    expect(help.code).toBe(0)
    expect(help.output).toContain('apiToken --')
    expect(help.output).toContain('--fixture')
    expect(help.output).toContain('defaultOrg example-org')

    const unsetHome = createTemporaryHome()
    writePersistedConfig(unsetHome, {
      defaultOrg: 'remove-this-org',
      apiProxy: 'https://proxy.example.test',
    })
    const unset = await runChildInHome(
      factoryFixturePath,
      ['unset', 'defaultOrg'],
      unsetHome,
    )
    expect(unset.code).toBe(0)
    expect(Object.hasOwn(unset.config ?? {}, 'defaultOrg')).toBe(false)
    expect(unset.config?.['apiProxy']).toBe('https://proxy.example.test')
  })

  it('rejects an undefined handler value before writing config', async () => {
    const result = await runChild(factoryFixturePath, ['undefined'])
    expect(result.code, result.exitDiagnostic).toBe(0)
    expect(result.output).toContain('undefined value rejected')
    expect(result.configFileExists).toBe(false)
  })
})
