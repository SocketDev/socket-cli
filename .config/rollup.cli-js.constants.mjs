/**
 * Minimal constants for unified build to avoid importing from @socketsecurity/registry.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootPath = path.join(__dirname, '..')

// Helper to check boolean environment variables.
function envAsBoolean(value) {
  if (value === undefined || value === null) {
    return false
  }
  const str = String(value).toLowerCase()
  return str === 'true' || str === '1' || str === 'yes'
}

export default {
  rootPath,
  srcPath: path.join(rootPath, 'src'),
  distPath: path.join(rootPath, 'dist'),
  ENV: {
    INLINED_SOCKET_CLI_PUBLISHED_BUILD: envAsBoolean(
      process.env.INLINED_SOCKET_CLI_PUBLISHED_BUILD,
    ),
    INLINED_SOCKET_CLI_LEGACY_BUILD: envAsBoolean(
      process.env.INLINED_SOCKET_CLI_LEGACY_BUILD,
    ),
    INLINED_SOCKET_CLI_SENTRY_BUILD: envAsBoolean(
      process.env.INLINED_SOCKET_CLI_SENTRY_BUILD,
    ),
  },
}
