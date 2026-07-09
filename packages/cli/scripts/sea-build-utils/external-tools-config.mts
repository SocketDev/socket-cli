import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

/**
 * Default logger instance for SEA build operations.
 */
export const logger = getDefaultLogger()

/**
 * External tools configuration loaded from bundle-tools.json. Contains version
 * info, GitHub repos, and download metadata for security tools.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalToolsPath = path.join(__dirname, '../../bundle-tools.json')
// Entries live under the `tools` key (the shared external-tools shape).
export const externalTools = JSON.parse(
  readFileSync(externalToolsPath, 'utf8'),
).tools

/**
 * Get the monorepo root path. Resolves to socket-cli/ directory regardless of
 * where script is run from.
 *
 * @returns Absolute path to monorepo root.
 */
export function getRootPath() {
  const scriptDirname = path.dirname(fileURLToPath(import.meta.url))
  return path.join(scriptDirname, '../../../..')
}
