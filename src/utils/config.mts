import fs from 'node:fs'
import path from 'node:path'

import config from '@socketsecurity/config'
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../constants.mts'
import { safeReadFileSync } from './fs.mts'

import type { CResult } from '../types.mts'

export interface LocalConfig {
  apiBaseUrl?: string | null | undefined
  // @deprecated ; use apiToken. when loading a config, if this prop exists it
  //               is deleted and set to apiToken instead, and then persisted.
  //               should only happen once for legacy users.
  apiKey?: string | null | undefined
  apiProxy?: string | null | undefined
  apiToken?: string | null | undefined
  defaultOrg?: string
  enforcedOrgs?: string[] | readonly string[] | null | undefined
  // Temporary to prepare (and mark) CLI API changes for the major bump
  isTestingV1?: boolean
}

export const supportedConfigKeys: Map<keyof LocalConfig, string> = new Map([
  ['apiBaseUrl', 'Base URL of the API endpoint'],
  ['apiProxy', 'A proxy through which to access the API'],
  ['apiToken', 'The API token required to access most API endpoints'],
  [
    'defaultOrg',
    'The default org slug to use; usually the org your API token has access to. When set, all orgSlug arguments are implied to be this value.'
  ],
  [
    'enforcedOrgs',
    'Orgs in this list have their security policies enforced on this machine'
  ],
  ['isTestingV1', 'For development of testing the next major bump']
])

export const sensitiveConfigKeys: Set<keyof LocalConfig> = new Set(['apiToken'])

let _cachedConfig: LocalConfig | undefined
// When using --config or SOCKET_CLI_CONFIG, do not persist the config.
let _readOnlyConfig = false

export function overrideCachedConfig(jsonConfig: unknown): CResult<undefined> {
  debugLog('Overriding entire config, marking config as read-only')

  let config
  try {
    config = JSON.parse(String(jsonConfig))
    if (!config || typeof config !== 'object') {
      // `null` is valid json, so are primitive values. They're not valid config objects :)
      return {
        ok: false,
        message: 'Could not parse Config as JSON',
        cause:
          "Could not JSON parse the config override. Make sure it's a proper JSON object (double-quoted keys and strings, no unquoted `undefined`) and try again."
      }
    }
  } catch {
    // Force set an empty config to prevent accidentally using system settings
    _cachedConfig = {} as LocalConfig
    _readOnlyConfig = true

    return {
      ok: false,
      message: 'Could not parse Config as JSON',
      cause:
        "Could not JSON parse the config override. Make sure it's a proper JSON object (double-quoted keys and strings, no unquoted `undefined`) and try again."
    }
  }

  // @ts-ignore Override an illegal object.
  _cachedConfig = config as LocalConfig
  _readOnlyConfig = true

  // Normalize apiKey to apiToken.
  if (_cachedConfig['apiKey']) {
    if (_cachedConfig['apiToken']) {
      logger.warn(
        'Note: The config override had both apiToken and apiKey. Using the apiToken value. Remove the apiKey to get rid of this message.'
      )
    }
    _cachedConfig['apiToken'] = _cachedConfig['apiKey']
    delete _cachedConfig['apiKey']
  }

  return { ok: true, data: undefined }
}

export function overrideConfigApiToken(apiToken: unknown) {
  debugLog('Overriding API token, marking config as read-only')
  // Set token to the local cached config and mark it read-only so it doesn't persist
  _cachedConfig = {
    ...config,
    ...(apiToken === undefined ? {} : { apiToken: String(apiToken) })
  } as LocalConfig
  _readOnlyConfig = true
}

function getConfigValues(): LocalConfig {
  if (_cachedConfig === undefined) {
    // Order: env var > --config flag > file
    _cachedConfig = {} as LocalConfig
    // Lazily access constants.socketAppPath.
    const { socketAppPath } = constants
    if (socketAppPath) {
      const raw = safeReadFileSync(socketAppPath)
      if (raw) {
        try {
          Object.assign(
            _cachedConfig,
            JSON.parse(Buffer.from(raw, 'base64').toString())
          )
        } catch {
          logger.warn(`Failed to parse config at ${socketAppPath}`)
        }
        // Normalize apiKey to apiToken and persist it.
        // This is a one time migration per user.
        if (_cachedConfig['apiKey']) {
          const token = _cachedConfig['apiKey']
          delete _cachedConfig['apiKey']
          updateConfigValue('apiToken', token)
        }
      } else {
        fs.mkdirSync(path.dirname(socketAppPath), { recursive: true })
      }
    }
  }
  return _cachedConfig
}

let _configPath: string | undefined
let _warnedConfigPathWin32Missing = false
export function getConfigPath(): string | undefined {
  // Get the OS app data folder:
  // - Win: %LOCALAPPDATA% or fail?
  // - Mac: %XDG_DATA_HOME% or fallback to "~/Library/Application Support/"
  // - Linux: %XDG_DATA_HOME% or fallback to "~/.local/share/"
  // Note: LOCALAPPDATA is typically: C:\Users\USERNAME\AppData
  // Note: XDG stands for "X Desktop Group", nowadays "freedesktop.org"
  //       On most systems that path is: $HOME/.local/share
  // Then append `socket/settings`, so:
  // - Win: %LOCALAPPDATA%\socket\settings or return undefined
  // - Mac: %XDG_DATA_HOME%/socket/settings or "~/Library/Application Support/socket/settings"
  // - Linux: %XDG_DATA_HOME%/socket/settings or "~/.local/share/socket/settings"

  const { LOCALAPPDATA, socketAppPath: SOCKET_APP_DIR } = constants

  if (_configPath === undefined) {
    // Lazily access constants.WIN32.
    const { WIN32 } = constants
    let dataHome: string | undefined = WIN32
      ? // Lazily access constants.ENV.LOCALAPPDATA
        constants.ENV.LOCALAPPDATA
      : // Lazily access constants.ENV.XDG_DATA_HOME
        constants.ENV.XDG_DATA_HOME
    if (!dataHome) {
      if (WIN32) {
        if (!_warnedConfigPathWin32Missing) {
          _warnedConfigPathWin32Missing = true
          logger.warn(`Missing %${LOCALAPPDATA}%`)
        }
      } else {
        dataHome = path.join(
          os.homedir(),
          ...(process.platform === 'darwin'
            ? ['Library', 'Application Support']
            : ['.local', 'share'])
        )
      }
    }
    _configPath = dataHome ? path.join(dataHome, SOCKET_APP_DIR) : undefined
  }
  return _configPath
}

function normalizeConfigKey(
  key: keyof LocalConfig
): CResult<keyof LocalConfig> {
  // Note: apiKey was the old name of the token. When we load a config with
  //       property apiKey, we'll copy that to apiToken and delete the old property.
  const normalizedKey = key === 'apiKey' ? 'apiToken' : key
  if (!supportedConfigKeys.has(normalizedKey)) {
    return {
      ok: false,
      message: `Invalid config key: ${normalizedKey}`,
      data: undefined
    }
  }
  return { ok: true, data: key }
}

export function findSocketYmlSync(dir = process.cwd()) {
  let prevDir = null
  while (dir !== prevDir) {
    let ymlPath = path.join(dir, 'socket.yml')
    let yml = safeReadFileSync(ymlPath)
    if (yml === undefined) {
      ymlPath = path.join(dir, 'socket.yaml')
      yml = safeReadFileSync(ymlPath)
    }
    if (typeof yml === 'string') {
      try {
        return {
          path: ymlPath,
          parsed: config.parseSocketConfig(yml)
        }
      } catch {
        throw new Error(`Found file but was unable to parse ${ymlPath}`)
      }
    }
    prevDir = dir
    dir = path.join(dir, '..')
  }
  return null
}

export function getConfigValue<Key extends keyof LocalConfig>(
  key: Key
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
  key: Key
): LocalConfig[Key] | undefined {
  const localConfig = getConfigValues()
  const keyResult = normalizeConfigKey(key)
  if (!keyResult.ok) {
    return undefined
  }
  return localConfig[keyResult.data as Key]
}
export function isReadOnlyConfig() {
  return _readOnlyConfig
}

let _pendingSave = false
export function updateConfigValue<Key extends keyof LocalConfig>(
  key: keyof LocalConfig,
  value: LocalConfig[Key]
): CResult<undefined | string> {
  const localConfig = getConfigValues()
  const keyResult = normalizeConfigKey(key)
  if (!keyResult.ok) {
    return keyResult
  }
  localConfig[keyResult.data as Key] = value
  if (_readOnlyConfig) {
    return {
      ok: true,
      message: `Config key '${key}' was updated`,
      data: 'Change applied but not persisted; current config is overridden through env var or flag'
    }
  }

  if (!_pendingSave) {
    _pendingSave = true
    process.nextTick(() => {
      _pendingSave = false
      // Lazily access constants.socketAppPath.
      const { socketAppPath } = constants
      if (socketAppPath) {
        fs.writeFileSync(
          socketAppPath,
          Buffer.from(JSON.stringify(localConfig)).toString('base64')
        )
      }
    })
  }

  return {
    ok: true,
    message: `Config key '${key}' was updated`,
    data: undefined
  }
}

export function isTestingV1() {
  return !!getConfigValueOrUndef('isTestingV1')
}
