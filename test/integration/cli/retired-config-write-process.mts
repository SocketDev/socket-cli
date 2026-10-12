import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setImmediate } from 'node:timers/promises'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import {
  getConfigValue,
  overrideCachedConfig,
  overrideConfigApiToken,
  resetConfigForTesting,
  updateConfigValue,
} from '../../../src/util/config.mts'
import { retiredSocketApiTokenFixture } from '../../helpers/retired-socket-api-token.mts'

const logger = getDefaultLogger()
const dataHome = process.env['XDG_DATA_HOME']
if (!dataHome) {
  throw new Error('XDG_DATA_HOME is required for the isolated process')
}

const configPath = path.join(dataHome, 'socket', 'settings', 'config.json')
const syntheticApiToken = 'sktsec_cli_synthetic_abc123' // socket-test-fake-token
const existingApiToken = 'sktsec_cli_existing_abc123' // socket-test-fake-token
const diskApiToken = 'sktsec_cli_disk_abc123' // socket-test-fake-token
const overrideApiToken = 'sktsec_cli_override_abc123' // socket-test-fake-token

function encodeConfig(config: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(config)).toString('base64')
}

function readConfig(): Record<string, unknown> {
  const encodedConfig = readFileSync(configPath, 'utf8')
  const decodedConfig = Buffer.from(encodedConfig, 'base64').toString('utf8')
  const parsed: unknown = JSON.parse(decodedConfig)
  if (!isPlainObject(parsed)) {
    throw new Error('Expected a persisted config object')
  }
  return parsed
}

function isRetiredRejection(
  result: ReturnType<typeof updateConfigValue>,
): boolean {
  return (
    !result.ok &&
    result.message === 'Authentication Error' &&
    result.cause?.includes('retired') === true
  )
}

async function runWriterScenario(): Promise<Record<string, boolean>> {
  const noInitialFile = !existsSync(configPath)
  const exact = updateConfigValue('apiToken', retiredSocketApiTokenFixture)
  const padded = updateConfigValue(
    'apiToken',
    ` \t${retiredSocketApiTokenFixture}\n `,
  )
  await setImmediate()
  const rejectedBeforeFile = !existsSync(configPath)

  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    encodeConfig({
      apiToken: existingApiToken,
      defaultOrg: 'safe-org',
    }),
  )
  resetConfigForTesting()
  const selectedBefore = getConfigValue('apiToken')
  const originalBytes = readFileSync(configPath)
  const existingRejected = updateConfigValue(
    'apiToken',
    retiredSocketApiTokenFixture,
  )
  await setImmediate()
  const selectedAfter = getConfigValue('apiToken')
  const existingPreserved = readFileSync(configPath).equals(originalBytes)
  const cachePreserved =
    selectedBefore.ok &&
    selectedBefore.data === existingApiToken &&
    selectedAfter.ok &&
    selectedAfter.data === existingApiToken

  const legitimate = updateConfigValue('apiToken', syntheticApiToken)
  await setImmediate()
  const legitimateConfig = readConfig()
  const legitimateWritePreservedSibling =
    legitimate.ok &&
    legitimateConfig['apiToken'] === syntheticApiToken &&
    legitimateConfig['defaultOrg'] === 'safe-org'

  const unset = updateConfigValue('apiToken', undefined)
  await setImmediate()
  const undefinedUnsetSupported =
    unset.ok && !Object.hasOwn(readConfig(), 'apiToken')

  const unrelated = updateConfigValue(
    'defaultOrg',
    retiredSocketApiTokenFixture,
  )
  await setImmediate()
  const unrelatedValueStored =
    unrelated.ok && readConfig()['defaultOrg'] === retiredSocketApiTokenFixture

  return {
    noInitialFile,
    exactRejected: isRetiredRejection(exact),
    paddedRejected: isRetiredRejection(padded),
    rejectedBeforeFile,
    existingRetiredRejected: isRetiredRejection(existingRejected),
    existingFilePreserved: existingPreserved,
    cachedSelectedTokenPreserved: cachePreserved,
    legitimateWritePreservedSibling,
    undefinedUnsetSupported,
    unrelatedKeyAccepted: unrelatedValueStored,
  }
}

async function runReadOnlyScenario(): Promise<Record<string, boolean>> {
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    encodeConfig({
      apiToken: diskApiToken,
      defaultOrg: 'disk-org',
    }),
  )
  resetConfigForTesting()
  const originalBytes = readFileSync(configPath)

  const override = overrideCachedConfig(
    JSON.stringify({
      apiToken: overrideApiToken,
      defaultOrg: 'override-org',
    }),
  )
  const fullOverrideWrite = updateConfigValue('defaultOrg', 'not-saved')
  const fullOverrideRetired = updateConfigValue(
    'apiToken',
    retiredSocketApiTokenFixture,
  )
  const fullOverrideSelected = getConfigValue('apiToken')
  const fullOverrideUnchanged = readFileSync(configPath).equals(originalBytes)

  resetConfigForTesting()
  overrideConfigApiToken(undefined)
  const noTokenSelectedBefore = getConfigValue('apiToken')
  const noTokenWrite = updateConfigValue('defaultOrg', 'not-saved')
  const noTokenRetired = updateConfigValue(
    'apiToken',
    retiredSocketApiTokenFixture,
  )
  const noTokenSelectedAfter = getConfigValue('apiToken')
  await setImmediate()

  return {
    fullOverrideValid: override.ok,
    fullOverrideNotSaved:
      fullOverrideWrite.ok && typeof fullOverrideWrite.data === 'string',
    fullOverrideRejectsRetired: isRetiredRejection(fullOverrideRetired),
    fullOverrideSelectedTokenPreserved:
      fullOverrideSelected.ok && fullOverrideSelected.data === overrideApiToken,
    fullOverrideDiskUnchanged: fullOverrideUnchanged,
    noTokenWriteNotSaved:
      noTokenWrite.ok && typeof noTokenWrite.data === 'string',
    noTokenRejectsRetired: isRetiredRejection(noTokenRetired),
    noTokenSelectedTokenPreserved:
      noTokenSelectedBefore.ok &&
      noTokenSelectedBefore.data === undefined &&
      noTokenSelectedAfter.ok &&
      noTokenSelectedAfter.data === undefined,
    noTokenDiskUnchanged: readFileSync(configPath).equals(originalBytes),
  }
}

async function main(): Promise<void> {
  const result =
    process.argv[2] === 'read-only'
      ? await runReadOnlyScenario()
      : await runWriterScenario()
  logger.log(JSON.stringify(result))
}

void main().catch(() => {
  process.exitCode = 1
})
