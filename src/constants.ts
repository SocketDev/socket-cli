import { envAsBoolean } from '@socketsecurity/registry/lib/env'

export const API_V0_URL = 'https://api.socket.dev/v0'

export const ENV = Object.freeze({
  // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
  UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: envAsBoolean(
    process.env['UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE']
  )
})
