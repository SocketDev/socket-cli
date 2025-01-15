import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

let dataHome: string | undefined =
  process.platform === 'win32'
    ? process.env['LOCALAPPDATA']
    : process.env['XDG_DATA_HOME']

if (!dataHome) {
  if (process.platform === 'win32') throw new Error('missing %LOCALAPPDATA%')
  const home = os.homedir()
  dataHome = path.join(
    home,
    ...(process.platform === 'darwin'
      ? ['Library', 'Application Support']
      : ['.local', 'share'])
  )
}

const settingsPath = path.join(dataHome, 'socket', 'settings')

interface Settings {
  apiKey?: string | null
  enforcedOrgs?: string[] | null
  apiBaseUrl?: string | null
  apiProxy?: string | null
}

let settings: Settings = {}

if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, 'utf8')
  try {
    settings = JSON.parse(Buffer.from(raw, 'base64').toString())
  } catch {
    new Spinner().warning(`Failed to parse settings at ${settingsPath}`)
  }
} else {
  mkdirSync(path.dirname(settingsPath), { recursive: true })
}

export function getSetting<Key extends keyof Settings>(
  key: Key
): Settings[Key] {
  return settings[key]
}

let pendingSave = false

export function updateSetting<Key extends keyof Settings>(
  key: Key,
  value: Settings[Key]
): void {
  settings[key] = value
  if (!pendingSave) {
    pendingSave = true
    process.nextTick(() => {
      pendingSave = false
      writeFileSync(
        settingsPath,
        Buffer.from(JSON.stringify(settings)).toString('base64')
      )
    })
  }
}
