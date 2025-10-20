/**
 * Configuration utilities for Socket CLI.
 * Manages CLI configuration including API tokens, org settings, and preferences.
 *
 * Configuration Hierarchy (highest priority first):
 * 1. Environment variables (SOCKET_CLI_*)
 * 2. Command-line --config flag
 * 3. Persisted config file (base64 encoded JSON)
 *
 * Supported Config Keys:
 * - apiBaseUrl: Socket API endpoint URL
 * - apiProxy: Proxy for API requests
 * - apiToken: Authentication token for Socket API
 * - defaultOrg/org: Default organization slug
 * - enforcedOrgs: Organizations with enforced security policies
 *
 * Key Functions:
 * - findSocketYmlSync: Locate socket.yml configuration file
 * - getConfigValue: Retrieve configuration value by key
 * - overrideCachedConfig: Apply temporary config overrides
 * - updateConfigValue: Persist configuration changes
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import config from '@socketsecurity/config'
import { debugDirNs, debugNs } from '@socketsecurity/lib/debug'
import { safeReadFileSync } from '@socketsecurity/lib/fs'
import { logger } from '@socketsecurity/lib/logger'
import { naturalCompare } from '@socketsecurity/lib/sorts'

import { debugConfig } from './debug.mts'
import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_ORG,
} from '../constants/config.mts'
import { getSocketAppDataPath } from '../constants/paths.mts'
import { SOCKET_YAML, SOCKET_YML } from '../constants/socket.mts'
import { getErrorCause } from './error/errors.mjs'

import type { CResult } from '../types.mjs'
import type { SocketYml } from '@socketsecurity/config'

export interface LocalConfig {
  apiBaseUrl?: string | null | undefined
  // @deprecated ; use apiToken. when loading a config, if this prop exists it
  //               is deleted and set to apiToken instead, and then persisted.
  //               should only happen once for legacy users.
  apiKey?: string | null | undefined
  apiProxy?: string | null | undefined
  apiToken?: string | null | undefined
  defaultOrg?: string | undefined
  enforcedOrgs?: string[] | readonly string[] | null | undefined
  skipAskToPersistDefaultOrg?: boolean | undefined
  // Convenience alias for defaultOrg.
  org?: string | undefined
}

const sensitiveConfigKeyLookup: Set<keyof LocalConfig> = new Set([
  CONFIG_KEY_API_TOKEN,
])

const supportedConfig: Map<keyof LocalConfig, string> = new Map([
  [CONFIG_KEY_API_BASE_URL, 'Base URL of the Socket API endpoint'],
  [CONFIG_KEY_API_PROXY, 'A proxy through which to access the Socket API'],
  [
    CONFIG_KEY_API_TOKEN,
    'The Socket API token required to access most Socket API endpoints',
  ],
  [
    CONFIG_KEY_DEFAULT_ORG,
    'The default org slug to use; usually the org your Socket API token has access to. When set, all orgSlug arguments are implied to be this value.',
  ],
  [
    CONFIG_KEY_ENFORCED_ORGS,
    'Orgs in this list have their security policies enforced on this machine',
  ],
  [
    'skipAskToPersistDefaultOrg',
    'This flag prevents the Socket CLI from asking you to persist the org slug when you selected one interactively',
  ],
  [CONFIG_KEY_ORG, 'Alias for defaultOrg'],
])

const supportedConfigEntries = [...supportedConfig.entries()].sort((a, b) =>
  naturalCompare(a[0], b[0]),
)
const supportedConfigKeys = supportedConfigEntries.map(p => p[0])

function getConfigValues(): LocalConfig {
  if (_cachedConfig === undefined) {
    // Order: env var > --config flag > file
    _cachedConfig = {} as LocalConfig
    const socketAppDataPath = getSocketAppDataPath()
    if (socketAppDataPath) {
      const configFilePath = path.join(socketAppDataPath, 'config.json')
      const raw = safeReadFileSync(configFilePath)
      if (raw) {
        try {
          const decoded =
            typeof raw === 'string'
              ? Buffer.from(raw, 'base64').toString()
              : Buffer.from(raw.toString(), 'base64').toString()
          Object.assign(_cachedConfig, JSON.parse(decoded))
          debugConfig(configFilePath, true)
        } catch (e) {
          logger.warn(`Failed to parse config at ${configFilePath}`)
          debugConfig(configFilePath, false, e)
        }
        // Normalize apiKey to apiToken and persist it.
        // This is a one time migration per user.
        if (_cachedConfig.apiKey) {
          const token = _cachedConfig.apiKey
          delete _cachedConfig.apiKey
          updateConfigValue(CONFIG_KEY_API_TOKEN, token)
        }
      } else {
        mkdirSync(socketAppDataPath, { recursive: true })
      }
    }
  }
  return _cachedConfig
}

function normalizeConfigKey(
  key: keyof LocalConfig,
): CResult<keyof LocalConfig> {
  // Note: apiKey was the old name of the token. When we load a config with
  //       property apiKey, we'll copy that to apiToken and delete the old property.
  // We added `org` as a convenience alias for `defaultOrg`
  const normalizedKey =
    key === 'apiKey'
      ? CONFIG_KEY_API_TOKEN
      : key === CONFIG_KEY_ORG
        ? CONFIG_KEY_DEFAULT_ORG
        : key
  if (!isSupportedConfigKey(normalizedKey)) {
    return {
      ok: false,
      message: `Invalid config key: ${normalizedKey}`,
      data: undefined,
    }
  }
  return { ok: true, data: normalizedKey }
}

export type FoundSocketYml = {
  path: string
  parsed: SocketYml
}

export function findSocketYmlSync(
  dir = process.cwd(),
): CResult<FoundSocketYml | undefined> {
  let prevDir = null
  while (dir !== prevDir) {
    let ymlPath = path.join(dir, SOCKET_YML)
    let yml = safeReadFileSync(ymlPath)
    if (yml === undefined) {
      ymlPath = path.join(dir, SOCKET_YAML)
      yml = safeReadFileSync(ymlPath)
    }
    if (typeof yml === 'string') {
      try {
        return {
          ok: true,
          data: {
            path: ymlPath,
            parsed: config.parseSocketConfig(yml),
          },
        }
      } catch (e) {
        debugNs('error', `Failed to parse config file: ${ymlPath}`)
        debugDirNs('error', e)
        return {
          ok: false,
          message: `Found file but was unable to parse ${ymlPath}`,
          cause: getErrorCause(e),
        }
      }
    }
    prevDir = dir
    dir = path.join(dir, '..')
  }
  return { ok: true, data: undefined }
}

export function getConfigValue<Key extends keyof LocalConfig>(
  key: Key,
): CResult<LocalConfig[Key]> {
  const localConfig = getConfigValues()
  const keyResult = normalizeConfigKey(key)
  if (!keyResult.ok) {
    return keyResult
  }
  return { ok: true, data: localConfig[keyResult.data as Key] }
}

// This version squashes errors, returning undefined instead.
// Should be used when we can reasonably predict the call can't fail.
export function getConfigValueOrUndef<Key extends keyof LocalConfig>(
  key: Key,
): LocalConfig[Key] | undefined {
  const localConfig = getConfigValues()
  const keyResult = normalizeConfigKey(key)
  if (!keyResult.ok) {
    return undefined
  }
  return localConfig[keyResult.data as Key]
}

// Ensure export because dist/utils.js is required in src/constants.mts.
// eslint-disable-next-line n/exports-style
if (typeof exports === 'object' && exports !== null) {
  // eslint-disable-next-line n/exports-style
  exports.getConfigValueOrUndef = getConfigValueOrUndef
}

export function getSupportedConfigEntries() {
  return [...supportedConfigEntries]
}

export function getSupportedConfigKeys() {
  return [...supportedConfigKeys]
}

export function isConfigFromFlag() {
  return _configFromFlag
}

export function isSensitiveConfigKey(key: string): key is keyof LocalConfig {
  return sensitiveConfigKeyLookup.has(key as keyof LocalConfig)
}

export function isSupportedConfigKey(key: string): key is keyof LocalConfig {
  return supportedConfig.has(key as keyof LocalConfig)
}

let _cachedConfig: LocalConfig | undefined
// When using --config or SOCKET_CLI_CONFIG, do not persist the config.
let _configFromFlag = false

export function overrideCachedConfig(jsonConfig: unknown): CResult<undefined> {
  debugNs('notice', 'override: full config (not stored)')

  let config
  try {
    config = JSON.parse(String(jsonConfig))
    if (!config || typeof config !== 'object') {
      // `null` is valid json, so are primitive values.
      // They're not valid config objects :)
      return {
        ok: false,
        message: 'Could not parse Config as JSON',
        cause:
          "Could not JSON parse the config override. Make sure it's a proper JSON object (double-quoted keys and strings, no unquoted `undefined`) and try again.",
      }
    }
  } catch {
    // Force set an empty config to prevent accidentally using system settings.
    _cachedConfig = {} as LocalConfig
    _configFromFlag = true

    return {
      ok: false,
      message: 'Could not parse Config as JSON',
      cause:
        "Could not JSON parse the config override. Make sure it's a proper JSON object (double-quoted keys and strings, no unquoted `undefined`) and try again.",
    }
  }

  _cachedConfig = config as LocalConfig
  _configFromFlag = true

  // Normalize apiKey to apiToken.
  if (_cachedConfig.apiKey) {
    if (_cachedConfig.apiToken) {
      logger.warn(
        'Note: The config override had both apiToken and apiKey. Using the apiToken value. Remove the apiKey to get rid of this message.',
      )
    }
    _cachedConfig.apiToken = _cachedConfig.apiKey
    delete _cachedConfig.apiKey
  }

  return { ok: true, data: undefined }
}

export function overrideConfigApiToken(apiToken: unknown) {
  debugNs('notice', 'override: Socket API token (not stored)')
  // Set token to the local cached config and mark it read-only so it doesn't persist.
  _cachedConfig = {
    ..._cachedConfig,
    ...(apiToken === undefined ? {} : { apiToken: String(apiToken) }),
  } as LocalConfig
  _configFromFlag = true
}

let _pendingSave = false
export function updateConfigValue<Key extends keyof LocalConfig>(
  configKey: keyof LocalConfig,
  value: LocalConfig[Key],
): CResult<undefined | string> {
  const localConfig = getConfigValues()
  const keyResult = normalizeConfigKey(configKey)
  if (!keyResult.ok) {
    return keyResult
  }
  const key: Key = keyResult.data as Key
  // Implicitly deleting when serializing.
  let wasDeleted = value === undefined
  if (key === 'skipAskToPersistDefaultOrg') {
    if (value === 'true' || value === 'false') {
      localConfig.skipAskToPersistDefaultOrg = value === 'true'
    } else {
      delete localConfig.skipAskToPersistDefaultOrg
      wasDeleted = true
    }
  } else {
    if (value === 'undefined' || value === 'true' || value === 'false') {
      logger.warn(
        `Note: The value is set to "${value}", as a string (!). Use \`socket config unset\` to reset a key.`,
      )
    }
    localConfig[key] = value
  }
  if (_configFromFlag) {
    return {
      ok: true,
      message: `Config key '${key}' was ${wasDeleted ? 'deleted' : 'updated'}`,
      data: 'Change applied but not persisted; current config is overridden through env var or flag',
    }
  }

  if (!_pendingSave) {
    _pendingSave = true
    process.nextTick(() => {
      _pendingSave = false
      const socketAppDataPath = getSocketAppDataPath()
      if (socketAppDataPath) {
        mkdirSync(socketAppDataPath, { recursive: true })
        const configFilePath = path.join(socketAppDataPath, 'config.json')
        writeFileSync(
          configFilePath,
          Buffer.from(JSON.stringify(localConfig)).toString('base64'),
        )
      }
    })
  }

  return {
    ok: true,
    message: `Config key '${key}' was ${wasDeleted ? 'deleted' : 'updated'}`,
    data: undefined,
  }
}
