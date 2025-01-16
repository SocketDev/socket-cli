import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from './logger'
import constants from '../constants'

const LOCALAPPDATA = 'LOCALAPPDATA'

interface Settings {
  apiKey?: string | null
  enforcedOrgs?: string[] | null
  apiBaseUrl?: string | null
  apiProxy?: string | null
}

let _settings: Settings | undefined
function getSettings(): Settings {
  if (_settings === undefined) {
    _settings = <Settings>{}
    const settingsPath = getSettingsPath()
    if (settingsPath) {
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, 'utf8')
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
      ? path.join(dataHome, 'socket', 'settings')
      : undefined
  }
  return _settingsPath
}

export function getSetting<Key extends keyof Settings>(
  key: Key
): Settings[Key] {
  return getSettings()[key]
}

let pendingSave = false
export function updateSetting<Key extends keyof Settings>(
  key: Key,
  value: Settings[Key]
): void {
  const settings = getSettings()
  settings[key] = value
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
