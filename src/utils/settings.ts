import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import config from '@socketsecurity/config'
import { logger } from '@socketsecurity/registry/lib/logger'

import { safeReadFileSync } from './fs'
import constants from '../constants'

const LOCALAPPDATA = 'LOCALAPPDATA'

const supportedApiKeys = new Set([
  'apiBaseUrl',
  'apiKey',
  'apiProxy',
  'enforcedOrgs'
])

interface Settings {
  apiBaseUrl?: string | null | undefined
  apiKey?: string | null | undefined
  apiProxy?: string | null | undefined
  enforcedOrgs?: string[] | Readonly<string[]> | null | undefined
  // apiToken is an alias for apiKey.
  apiToken?: string | null | undefined
}

let _settings: Settings | undefined
function getSettings(): Settings {
  if (_settings === undefined) {
    _settings = <Settings>{}
    const settingsPath = getSettingsPath()
    if (settingsPath) {
      const raw = <string | undefined>safeReadFileSync(settingsPath, 'utf8')
      if (raw) {
        try {
          Object.assign(
            _settings,
            JSON.parse(Buffer.from(raw, 'base64').toString())
          )
        } catch {
          logger.warn(`Failed to parse settings at ${settingsPath}`)
        }
      } else {
        mkdirSync(path.dirname(settingsPath), { recursive: true })
      }
    }
  }
  return _settings
}

let _settingsPath: string | undefined
let _warnedSettingPathWin32Missing = false
function getSettingsPath(): string | undefined {
  if (_settingsPath === undefined) {
    // Lazily access constants.WIN32.
    const { WIN32 } = constants
    let dataHome: string | undefined = WIN32
      ? process.env[LOCALAPPDATA]
      : process.env['XDG_DATA_HOME']
    if (!dataHome) {
      if (WIN32) {
        if (!_warnedSettingPathWin32Missing) {
          _warnedSettingPathWin32Missing = true
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
    _settingsPath = dataHome
      ? path.join(dataHome, 'socket/settings')
      : undefined
  }
  return _settingsPath
}

function normalizeSettingsKey(key: string): string {
  const normalizedKey = key === 'apiToken' ? 'apiKey' : key
  if (!supportedApiKeys.has(normalizedKey)) {
    throw new Error(`Invalid settings key: ${normalizedKey}`)
  }
  return normalizedKey
}

export function findSocketYmlSync() {
  let prevDir = null
  let dir = process.cwd()
  while (dir !== prevDir) {
    let ymlPath = path.join(dir, 'socket.yml')
    let yml = <string | undefined>safeReadFileSync(ymlPath, 'utf8')
    if (yml === undefined) {
      ymlPath = path.join(dir, 'socket.yaml')
      yml = <string | undefined>safeReadFileSync(ymlPath, 'utf8')
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
  return getSettings()[<Key>normalizeSettingsKey(key)]
}

let pendingSave = false
export function updateSetting<Key extends keyof Settings>(
  key: Key,
  value: Settings[Key]
): void {
  const settings = getSettings()
  ;(settings as any)[<Key>normalizeSettingsKey(key)] = value
  if (!pendingSave) {
    pendingSave = true
    process.nextTick(() => {
      pendingSave = false
      const settingsPath = getSettingsPath()
      if (settingsPath) {
        writeFileSync(
          settingsPath,
          Buffer.from(JSON.stringify(settings)).toString('base64')
        )
      }
    })
  }
}
