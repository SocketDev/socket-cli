/**
 * Network error diagnostics for Socket CLI. Classifies network-related error
 * codes and produces actionable recovery guidance.
 */

import { isErrnoException } from '@socketsecurity/lib-stable/errors/predicates'

import { SOCKET_STATUS_URL } from '../../constants/socket.mts'

import { getErrorMessage } from './errors-messages.mts'

/**
 * Detect network-related error codes from Node.js errors.
 */
export function getNetworkErrorCode(error: unknown): string | undefined {
  if (!isErrnoException(error)) {
    return undefined
  }
  return error.code
}

/**
 * Get network error diagnostics with actionable guidance. Provides specific
 * recovery steps based on error type.
 *
 * @example
 *   const diagnostics = getNetworkErrorDiagnostics(error, 5000)
 *   // Returns: "Connection refused. The server may be down..."
 *
 * @param error - The error to diagnose.
 * @param durationMs - Optional request duration in milliseconds.
 *
 * @returns Diagnostic message with recovery suggestions
 */
export function getNetworkErrorDiagnostics(
  error: unknown,
  durationMs?: number | undefined,
): string {
  const errorCode = getNetworkErrorCode(error)
  const errorMessage = getErrorMessage(error) || String(error)

  // Timeout errors.
  if (
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ESOCKETTIMEDOUT' ||
    errorCode === 'ECONNRESET' ||
    (durationMs && durationMs > 30_000)
  ) {
    const timeInfo = durationMs
      ? ` after ${Math.round(durationMs / 1000)}s`
      : ''
    return (
      `Request timeout${timeInfo}. The server took too long to respond.\n` +
      '💡 Try:\n' +
      '  • Check your internet connection speed\n' +
      '  • Retry the request - the server may be temporarily slow\n' +
      `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
      '  • Contact support if timeouts persist'
    )
  }

  // Connection refused.
  if (errorCode === 'ECONNREFUSED') {
    return (
      'Connection refused. The server actively rejected the connection.\n' +
      '💡 Try:\n' +
      '  • Check if you are using a proxy or VPN that may be blocking the connection\n' +
      '  • Verify your firewall settings\n' +
      `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
      '  • Ensure SOCKET_CLI_API_BASE_URL is set correctly (if configured)'
    )
  }

  // DNS resolution failures.
  if (
    errorCode === 'ENOTFOUND' ||
    errorCode === 'EAI_AGAIN' ||
    errorMessage.includes('getaddrinfo')
  ) {
    return (
      'DNS resolution failed. Unable to resolve the server hostname.\n' +
      '💡 Try:\n' +
      '  • Check your internet connection\n' +
      '  • Verify DNS settings (try 8.8.8.8 or 1.1.1.1)\n' +
      '  • Check if a VPN or proxy is interfering\n' +
      '  • Ensure SOCKET_CLI_API_BASE_URL is correct (if configured)\n' +
      '  • Try again in a few moments'
    )
  }

  // Certificate/SSL errors.
  if (
    errorCode === 'CERT_HAS_EXPIRED' ||
    errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    errorCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    errorMessage.includes('certificate')
  ) {
    return (
      'SSL/TLS certificate error. Unable to verify server identity.\n' +
      '💡 Try:\n' +
      '  • Check your system date and time are correct\n' +
      '  • Update your system certificates\n' +
      '  • Check if a proxy is intercepting HTTPS traffic\n' +
      '  • Contact your IT department if behind corporate firewall'
    )
  }

  // Network unreachable.
  if (errorCode === 'EHOSTUNREACH' || errorCode === 'ENETUNREACH') {
    return (
      'Network unreachable. Cannot reach the destination network.\n' +
      '💡 Try:\n' +
      '  • Check your internet connection\n' +
      '  • Verify network/WiFi is connected\n' +
      '  • Check if VPN or firewall is blocking access\n' +
      '  • Try a different network'
    )
  }

  // Generic network error with basic guidance.
  return (
    `Network error: ${errorMessage}\n` +
    '💡 Try:\n' +
    '  • Check your internet connection\n' +
    '  • Verify proxy settings if using a proxy\n' +
    `  • Check Socket status: ${SOCKET_STATUS_URL}\n` +
    '  • Try again in a few moments'
  )
}
