/**
 * Error message constants for Socket CLI.
 */

export const ERROR_NO_MANIFEST_FILES = 'No manifest files found'
export const ERROR_NO_PACKAGE_JSON = 'No package.json found'
export const ERROR_NO_REPO_FOUND = 'No repo found'
export const ERROR_NO_SOCKET_DIR = 'No .socket directory found'
export const ERROR_UNABLE_RESOLVE_ORG =
  'Unable to resolve a Socket account organization'

/**
 * Sentinel value to detect infinite loops during tree traversal.
 * Used as a safety check when walking dependency trees.
 */
export const LOOP_SENTINEL = 50_000
