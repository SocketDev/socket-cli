/**
 * Socket.dev specific constants for the CLI (extends registry socket constants).
 */

// Re-export NPM registry URL from registry for backward compatibility.
export { NPM_REGISTRY_URL } from '@socketsecurity/lib-internal/constants/agents'

// Socket API URLs
export const API_V0_URL = 'https://api.socket.dev/v0/'
export const SOCKET_WEBSITE_URL = 'https://socket.dev'
export const SOCKET_CONTACT_URL = 'https://socket.dev/contact'
export const SOCKET_DASHBOARD_URL = 'https://socket.dev/dashboard'
export const SOCKET_PRICING_URL = 'https://socket.dev/pricing'
export const SOCKET_SETTINGS_API_TOKENS_URL =
  'https://socket.dev/settings/api-tokens'
export const SOCKET_STATUS_URL = 'https://status.socket.dev'

// Socket Configuration Files
export const SOCKET_JSON = 'socket.json'
export const SOCKET_YAML = 'socket.yaml'
export const SOCKET_YML = 'socket.yml'

// Socket Repository Metadata
export const SOCKET_DEFAULT_BRANCH = 'socket-default-branch'
export const SOCKET_DEFAULT_REPOSITORY = 'socket-default-repository'

// Token
export const TOKEN_PREFIX = 'sktsec_'
export const TOKEN_PREFIX_LENGTH = TOKEN_PREFIX.length

// Documentation
export const V1_MIGRATION_GUIDE_URL =
  'https://docs.socket.dev/docs/v1-migration-guide'

// GitHub
export const SOCKET_CLI_ISSUES_URL =
  'https://github.com/SocketDev/socket-cli/issues'
