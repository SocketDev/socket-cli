/**
 * @fileoverview Feature flags for experimental features.
 *
 * Environment variables control experimental feature enablement.
 */

/**
 * Check if iocraft TUI rendering should be used instead of Ink.
 *
 * Enable with: SOCKET_CLI_USE_IOCRAFT=1
 *
 * @returns {boolean} True if iocraft should be used
 */
export function useIocraft(): boolean {
  return process.env['SOCKET_CLI_USE_IOCRAFT'] === '1'
}

/**
 * Check if Ink TUI rendering should be used (default).
 *
 * Disable with: SOCKET_CLI_USE_IOCRAFT=1
 *
 * @returns {boolean} True if Ink should be used
 */
export function useInk(): boolean {
  return !useIocraft()
}
