/**
 * @file Minimal .env file parser for build and test scripts.
 */

import { readFileSync } from 'node:fs'

/**
 * Parse a .env file and return key-value pairs. Supports comments (#), blank
 * lines, KEY=value, KEY="value", KEY='value'. Returns an empty object if the
 * file does not exist.
 */
export function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = { __proto__: null } as Record<
    string,
    string
  >
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return env
  }
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    // Skip comments and blank lines.
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) {
      continue
    }
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}
