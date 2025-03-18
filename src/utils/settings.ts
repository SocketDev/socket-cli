import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import config from '@socketsecurity/config'
import { logger } from '@socketsecurity/registry/lib/logger'

import { safeReadFileSync } from './fs'
import constants from '../constants'

// Default app data folder env var on Win
const LOCALAPPDATA = 'LOCALAPPDATA'
// Default app data folder env var on Mac/Linux
const XDG_DATA_HOME = 'XDG_DATA_HOME'
const SOCKET_APP_DIR = 'socket/settings'

const supportedApiKeys: Set<keyof Settings> = new Set([
  'apiBaseUrl',
  'apiKey',
  'apiProxy',
  'enforcedOrgs'
])

interface Settings {
  apiBaseUrl?: string | null | undefined
  // @deprecated
  apiKey?: string | null | undefined
  apiProxy?: string | null | undefined
  enforcedOrgs?: string[] | readonly string[] | null | undefined
  // apiToken is an alias for apiKey.
  apiToken?: string | null | undefined
}

let settings: Settings | undefined
let settingsPath: string | undefined
let warnedSettingPathWin32Missing = false
let pendingSave = false

function getSettings(): Settings {
  if (settings === undefined) {
    settings = {} as Settings
    const settingsPath = getSettingsPath()
    if (settingsPath) {
      const raw = safeReadFileSync(settingsPath)
      if (raw) {
        try {
          Object.assign(
            settings,
            JSON.parse(Buffer.from(raw, 'base64').toString())
          )
        } catch {
          logger.warn(`Failed to parse settings at ${settingsPath}`)
        }
      } else {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
      }
    }
  }
  return settings
}

function getSettingsPath(): string | undefined {
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

  if (settingsPath === undefined) {
    // Lazily access constants.WIN32.
    const { WIN32 } = constants
    let dataHome: string | undefined = WIN32
      ? process.env[LOCALAPPDATA]
      : process.env[XDG_DATA_HOME]
    if (!dataHome) {
      if (WIN32) {
        if (!warnedSettingPathWin32Missing) {
          warnedSettingPathWin32Missing = true
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
    settingsPath = dataHome ? path.join(dataHome, SOCKET_APP_DIR) : undefined
  }
  return settingsPath
}

function normalizeSettingsKey(key: keyof Settings): keyof Settings {
  const normalizedKey = key === 'apiToken' ? 'apiKey' : key
  if (!supportedApiKeys.has(normalizedKey as keyof Settings)) {
    throw new Error(`Invalid settings key: ${normalizedKey}`)
  }
  return normalizedKey as keyof Settings
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

export function getSetting<Key extends keyof Settings>(
  key: Key
): Settings[Key] {
  return getSettings()[normalizeSettingsKey(key) as Key]
}

export function updateSetting<Key extends keyof Settings>(
  key: Key,
  value: Settings[Key]
): void {
  const settings = getSettings()
  settings[normalizeSettingsKey(key) as Key] = value
  if (!pendingSave) {
    pendingSave = true
    process.nextTick(() => {
      pendingSave = false
      const settingsPath = getSettingsPath()
      if (settingsPath) {
        fs.writeFileSync(
          settingsPath,
          Buffer.from(JSON.stringify(settings)).toString('base64')
        )
      }
    })
  }
}
