import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// @ts-ignore no types for ascii85
import ascii85 from 'ascii85'

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

/** @type {any} */
let settings = {}

if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath)
  try {
    settings = JSON.parse(ascii85.decode(raw).toString())
  } catch (e) {
    // failed decode - don't load
  }
} else {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
}

/**
 * @param {string} key
 * @returns {any}
 */
export function getSetting (key) {
  return settings[key]
}

/**
 * @param {string} key
 * @param {any} value
 * @returns {void}
 */
export function updateSetting (key, value) {
  settings[key] = value
  fs.writeFileSync(
    settingsPath,
    ascii85.encode(JSON.stringify(settings))
  )
}
