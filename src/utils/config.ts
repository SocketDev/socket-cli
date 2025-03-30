import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import config from '@socketsecurity/config'
import { logger } from '@socketsecurity/registry/lib/logger'

import { safeReadFileSync } from './fs'
import constants from '../constants'

const { LOCALAPPDATA, SOCKET_APP_DIR, XDG_DATA_HOME } = constants

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
}

export const supportedConfigKeys: Map<keyof LocalConfig, string> = new Map([
  ['apiBaseUrl', 'Base URL of the API endpoint'],
  ['apiProxy', 'A proxy through which to access the API'],
  ['apiToken', 'The API token required to access most API endpoints'],
  [
    'defaultOrg',
    'The default org slug to use when appropriate; usually the org your API token has access to. When set, all orgSlug arguments are implied to be this value.'
  ],
  [
    'enforcedOrgs',
    'Orgs in this list have their security policies enforced on this machine'
  ]
])

export const sensitiveConfigKeys: Set<keyof LocalConfig> = new Set(['apiToken'])

let _cachedConfig: LocalConfig | undefined
// When using --config or SOCKET_CLI_CONFIG_OVERRIDE, do not persist the config.
let _readOnlyConfig = false
export function overrideCachedConfig(config: object) {
  _cachedConfig = { ...config } as LocalConfig
  _readOnlyConfig = true
  // Normalize apiKey to apiToken.
  if (_cachedConfig['apiKey']) {
    _cachedConfig['apiToken'] = _cachedConfig['apiKey']
    delete _cachedConfig['apiKey']
  }
}

function getConfigValues(): LocalConfig {
  if (_cachedConfig === undefined) {
    _cachedConfig = {} as LocalConfig
    // Order: env var > --config flag > file
    const configPath = getConfigPath()
    if (configPath) {
      const raw = safeReadFileSync(configPath)
      if (raw) {
        try {
          Object.assign(
            _cachedConfig,
            JSON.parse(Buffer.from(raw, 'base64').toString())
          )
        } catch {
          logger.warn(`Failed to parse config at ${configPath}`)
        }
        // Normalize apiKey to apiToken and persist it.
        // This is a one time migration per user.
        if (_cachedConfig['apiKey']) {
          const token = _cachedConfig['apiKey']
          delete _cachedConfig['apiKey']
          updateConfigValue('apiToken', token)
        }
      } else {
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
      }
    }
  }
  return _cachedConfig
}

let _configPath: string | undefined
let _warnedConfigPathWin32Missing = false
function getConfigPath(): string | undefined {
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

  if (_configPath === undefined) {
    // Lazily access constants.WIN32.
    const { WIN32 } = constants
    let dataHome: string | undefined = WIN32
      ? // Lazily access constants.ENV[LOCALAPPDATA]
        constants.ENV[LOCALAPPDATA]
      : // Lazily access constants.ENV[XDG_DATA_HOME]
        constants.ENV[XDG_DATA_HOME]
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

function normalizeConfigKey(key: keyof LocalConfig): keyof LocalConfig {
  // Note: apiKey was the old name of the token. When we load a config with
  //       property apiKey, we'll copy that to apiToken and delete the old property.
  const normalizedKey = key === 'apiKey' ? 'apiToken' : key
  if (!supportedConfigKeys.has(normalizedKey)) {
    throw new Error(`Invalid config key: ${normalizedKey}`)
  }
  return normalizedKey
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
): LocalConfig[Key] {
  const localConfig = getConfigValues()
  return localConfig[normalizeConfigKey(key)] as LocalConfig[Key]
}

let _pendingSave = false
export function updateConfigValue<Key extends keyof LocalConfig>(
  key: keyof LocalConfig,
  value: LocalConfig[Key]
): void {
  const localConfig = getConfigValues()
  localConfig[normalizeConfigKey(key) as Key] = value
  if (_readOnlyConfig) {
    logger.warn(
      'Not persisting config change; current config overridden through env var or flag'
    )
  } else if (!_pendingSave) {
    _pendingSave = true
    process.nextTick(() => {
      _pendingSave = false
      const configPath = getConfigPath()
      if (configPath) {
        fs.writeFileSync(
          configPath,
          Buffer.from(JSON.stringify(localConfig)).toString('base64')
        )
      }
    })
  }
}
