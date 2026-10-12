import { describe, expect, it } from 'vitest'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  cliPath,
  createChildEnvironment,
  createTemporaryHome,
  readPersistedTokenMatches,
  runChild,
  runWriterFixture,
  syntheticApiToken,
} from './config/util.mts'
import { FLAG_DRY_RUN, FLAG_JSON } from '../../../src/constants/cli.mts'
import { retiredSocketApiTokenFixture } from '../../helpers/retired-socket-api-token.mts'

describe('retired API token config writes', () => {
  it('rejects writes before disk or cache changes', async () => {
    const report = await runWriterFixture('writer')
    for (const field of [
      'noInitialFile',
      'exactRejected',
      'paddedRejected',
      'rejectedBeforeFile',
      'existingRetiredRejected',
      'existingFilePreserved',
      'cachedSelectedTokenPreserved',
      'legitimateWritePreservedSibling',
      'undefinedUnsetSupported',
      'unrelatedKeyAccepted',
    ]) {
      expect(report[field]).toBe(true)
    }
  })

  it('keeps override writes read-only', async () => {
    const report = await runWriterFixture('read-only')
    for (const field of [
      'fullOverrideValid',
      'fullOverrideNotSaved',
      'fullOverrideRejectsRetired',
      'fullOverrideSelectedTokenPreserved',
      'fullOverrideDiskUnchanged',
      'noTokenWriteNotSaved',
      'noTokenRejectsRetired',
      'noTokenSelectedTokenPreserved',
      'noTokenDiskUnchanged',
    ]) {
      expect(report[field]).toBe(true)
    }
  })

  it('rejects retired values in commands and dry run', async () => {
    for (const args of [
      ['config', 'set', 'apiToken', retiredSocketApiTokenFixture],
      ['config', 'set', FLAG_JSON, 'apiToken', retiredSocketApiTokenFixture],
      ['config', 'set', FLAG_DRY_RUN, 'apiToken', retiredSocketApiTokenFixture],
      [
        'config',
        'set',
        FLAG_DRY_RUN,
        FLAG_JSON,
        'apiToken',
        retiredSocketApiTokenFixture,
      ],
    ]) {
      const result = await runChild(cliPath, args, {
        DEBUG: '*',
        SOCKET_CLI_DEBUG: '1',
      })
      expect(result.code).toBe(2)
      expect(result.outputHasRetiredGuidance).toBe(true)
      expect(result.outputHasDryRunPreview).toBe(false)
      expect(result.outputContainsRetiredToken).toBe(false)
      expect(result.configFileExists).toBe(false)
    }
  })

  it('redacts API token debug output in text and JSON modes', async () => {
    for (const outputFlag of [undefined, FLAG_JSON]) {
      const home = createTemporaryHome()
      const args = ['config', 'set']
      if (outputFlag) {
        args.push(outputFlag)
      }
      args.push('apiToken', syntheticApiToken)
      const result = await spawn(process.execPath, [cliPath, ...args], {
        cwd: home,
        env: createChildEnvironment(home, {
          DEBUG: '*',
          SOCKET_CLI_DEBUG: '1',
        }),
        killTreeOnTimeout: true,
        stdio: 'pipe',
        stdioString: true,
        throws: false,
        timeout: 15_000,
      })
      const output = `${result.stdout}\n${result.stderr}`
      expect(result.code).toBe(0)
      expect(output.includes(syntheticApiToken)).toBe(false)
      expect(readPersistedTokenMatches(home, syntheticApiToken)).toBe(true)
    }
  })

  it('shows safe output for success and rejected writes', async () => {
    const success = await runChild(
      cliPath,
      ['config', 'set', 'defaultOrg', 'debug-safe-org'],
      { DEBUG: '*', SOCKET_CLI_DEBUG: '1' },
    )
    expect(success.code).toBe(0)
    expect(success.output).toContain("Config key 'defaultOrg' was updated")
    expect(success.outputContainsSyntheticToken).toBe(false)

    const failure = await runChild(
      cliPath,
      ['config', 'set', 'apiToken', syntheticApiToken],
      {
        DEBUG: '*',
        SOCKET_CLI_CONFIG: JSON.stringify({ apiToken: syntheticApiToken }),
        SOCKET_CLI_DEBUG: '1',
      },
    )
    expect(failure.code, failure.exitDiagnostic).not.toBe(0)
    expect(failure.outputHasNotSavedMessage).toBe(true)
    expect(failure.outputContainsSyntheticToken).toBe(false)
  })

  it('redacts token previews and shows default org values', async () => {
    const tokenResult = await runChild(cliPath, [
      'config',
      'set',
      FLAG_DRY_RUN,
      'apiToken',
      syntheticApiToken,
    ])
    expect(tokenResult.outputHasDryRunPreview).toBe(true)
    expect(tokenResult.outputHasRedaction).toBe(true)
    expect(tokenResult.outputContainsSyntheticToken).toBe(false)
    expect(tokenResult.configFileExists).toBe(false)

    const organizationResult = await runChild(cliPath, [
      'config',
      'set',
      FLAG_DRY_RUN,
      'defaultOrg',
      'example-org',
    ])
    expect(organizationResult.outputHasDryRunPreview).toBe(true)
    expect(organizationResult.outputShowsNonSensitiveValue).toBe(true)
    expect(organizationResult.outputContainsRetiredToken).toBe(false)
    expect(organizationResult.outputContainsSyntheticToken).toBe(false)
    expect(organizationResult.configFileExists).toBe(false)
  })

  it('keeps command overrides read-only', async () => {
    const overrideEntries: Array<readonly [string, string]> = [
      ['SOCKET_CLI_CONFIG', JSON.stringify({ apiToken: syntheticApiToken })],
      ['SOCKET_CLI_NO_API_TOKEN', 'true'],
    ]
    for (const [key, value] of overrideEntries) {
      const environment: Record<string, string> = { [key]: value }
      const result = await runChild(
        cliPath,
        ['config', 'set', 'apiToken', syntheticApiToken],
        environment,
      )
      expect(result.code).not.toBe(0)
      expect(result.outputHasNotSavedMessage).toBe(true)
      expect(result.outputContainsSyntheticToken).toBe(false)
      expect(result.configFileExists).toBe(false)
      const retiredResult = await runChild(
        cliPath,
        ['config', 'set', 'apiToken', retiredSocketApiTokenFixture],
        environment,
      )
      expect(retiredResult.code).toBe(2)
      expect(retiredResult.outputContainsRetiredToken).toBe(false)
      expect(retiredResult.configFileExists).toBe(false)
    }
  })
})
