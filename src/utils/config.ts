import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import config from '@socketsecurity/config'
import { logger } from '@socketsecurity/registry/lib/logger'

import { safeReadFileSync } from './fs'
import constants from '../constants'

export interface LocalConfig {
  apiBaseUrl?: string | null | undefined
  // @deprecated ; use apiToken
  apiKey?: string | null | undefined
  apiProxy?: string | null | undefined
  // apiToken replaced apiKey.
  apiToken?: string | null | undefined
  defaultOrg?: string
  enforcedOrgs?: string[] | readonly string[] | null | undefined
  // Ignore.
  test?: unknown
}

// Default app data folder env var on Win
const LOCALAPPDATA = 'LOCALAPPDATA'
// Default app data folder env var on Mac/Linux
const XDG_DATA_HOME = 'XDG_DATA_HOME'
const SOCKET_APP_DIR = 'socket/settings' // It used to be settings...

export const supportedConfigKeys: Map<keyof LocalConfig, string> = new Map([
  ['apiBaseUrl', 'Base URL of the API endpoint'],
  ['apiToken', 'The API token required to access most API endpoints'],
  ['apiProxy', 'A proxy through which to access the API'],
  [
    'enforcedOrgs',
    'Orgs in this list have their security policies enforced on this machine'
  ]
])

export const sensitiveConfigKeys: Set<keyof LocalConfig> = new Set(['apiToken'])

let cachedConfig: LocalConfig | undefined
// When using --config or SOCKET_CLI_CONFIG_OVERRIDE, do not persist the config
let readOnlyConfig = false
let configPath: string | undefined
let warnedConfigPathWin32Missing = false
let pendingSave = false

export function overrideCachedConfig(config: unknown) {
  cachedConfig = config as LocalConfig
  readOnlyConfig = true
}

function getConfigValues(): LocalConfig {
  if (cachedConfig === undefined) {
    cachedConfig = {} as LocalConfig
    // Order: env var > --config flag > file
    const configPath = getConfigPath()
    if (configPath) {
      const raw = safeReadFileSync(configPath)
      if (raw) {
        try {
          Object.assign(
            cachedConfig,
            JSON.parse(Buffer.from(raw, 'base64').toString())
          )
        } catch {
          logger.warn(`Failed to parse config at ${configPath}`)
        }
      } else {
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
      }
    }
  }
  return cachedConfig
}

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

  if (configPath === undefined) {
    // Lazily access constants.WIN32.
    const { WIN32 } = constants
    let dataHome: string | undefined = WIN32
      ? process.env[LOCALAPPDATA]
      : process.env[XDG_DATA_HOME]
    if (!dataHome) {
      if (WIN32) {
        if (!warnedConfigPathWin32Missing) {
          warnedConfigPathWin32Missing = true
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
    configPath = dataHome ? path.join(dataHome, SOCKET_APP_DIR) : undefined
  }
  return configPath
}

function normalizeConfigKey(key: keyof LocalConfig): keyof LocalConfig {
  const normalizedKey = key === 'apiToken' ? 'apiKey' : key
  if (
    normalizedKey !== 'apiKey' &&
    normalizedKey !== 'test' &&
    !supportedConfigKeys.has(normalizedKey as keyof LocalConfig)
  ) {
    throw new Error(`Invalid config key: ${normalizedKey}`)
  }
  return normalizedKey as keyof LocalConfig
}

export function findSocketYmlSync() {
  let prevDir = null
  let dir = process.cwd()
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
  return getConfigValues()[normalizeConfigKey(key) as Key]
}

export function updateConfigValue<Key extends keyof LocalConfig>(
  key: keyof LocalConfig,
  value: LocalConfig[Key]
): void {
  const localConfig = getConfigValues()
  localConfig[normalizeConfigKey(key) as Key] = value
  if (readOnlyConfig) {
    logger.error(
      'Not persisting config change; current config overridden through env var or flag'
    )
  } else if (!pendingSave) {
    pendingSave = true
    process.nextTick(() => {
      pendingSave = false
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
