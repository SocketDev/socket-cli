import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import ora from 'ora'

let dataHome = process.platform === 'win32'
  ? process.env['LOCALAPPDATA']
  : process.env['XDG_DATA_HOME']

if (!dataHome) {
  if (process.platform === 'win32') throw new Error('missing %LOCALAPPDATA%')
  const home = os.homedir()
  dataHome = path.join(home, ...(process.platform === 'darwin'
    ? ['Library', 'Application Support']
    : ['.local', 'share']
  ))
}

const settingsPath = path.join(dataHome, 'socket', 'settings')

/**
 * @typedef {import('@socketsecurity/sdk').SocketSdkReturnType<'getSettings'>['data']['organizations'][string]['issueRules']} IssueRules
 */

/** @type {{apiKey?: string | null, enforcedOrgs?: string[] | null}} */
let settings = {}

if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf-8')
  try {
    settings = JSON.parse(Buffer.from(raw, 'base64').toString())
  } catch (e) {
    ora(`Failed to parse settings at ${settingsPath}`).warn()
  }
} else {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
}

/**
 * @template {keyof typeof settings} Key
 * @param {Key} key
 * @returns {typeof settings[Key]}
 */
export function getSetting (key) {
  return settings[key]
}

let pendingSave = false

/**
 * @template {keyof typeof settings} Key
 * @param {Key} key
 * @param {typeof settings[Key]} value
 * @returns {void}
 */
export function updateSetting (key, value) {
  settings[key] = value
  if (!pendingSave) {
    pendingSave = true
    process.nextTick(() => {
      pendingSave = false
      fs.writeFileSync(
        settingsPath,
        Buffer.from(JSON.stringify(settings)).toString('base64')
      )
    })
  }
}
