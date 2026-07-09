/**
 * Error classes for Socket CLI. Each error type carries recovery suggestions
 * so callers can surface actionable guidance alongside the failure message.
 */

import {
  SOCKET_DASHBOARD_URL,
  SOCKET_PRICING_URL,
} from '../../constants/socket.mts'

/**
 * Authentication error with recovery suggestions. Thrown when API
 * authentication fails (401/403).
 */
export class AuthError extends Error {
  public readonly recovery: string[]

  constructor(message: string, recovery?: string[]) {
    super(message)
    this.name = 'AuthError'
    this.recovery = recovery || [
      'Run `socket login` to authenticate',
      'Set SOCKET_SECURITY_API_KEY environment variable',
      'Add apiToken to ~/.config/socket/config.toml',
    ]
  }
}

/**
 * User input validation error with details. Thrown when user provides invalid
 * input or arguments.
 */
export class InputError extends Error {
  public readonly body: string | undefined
  public readonly recovery: string[]

  constructor(message: string, body?: string | undefined, recovery?: string[]) {
    super(message)
    this.name = 'InputError'
    this.body = body
    this.recovery = recovery || ['Check command syntax with --help']
  }
}

/**
 * Network error with retry suggestions. Thrown when network requests fail due
 * to connectivity issues.
 */
export class NetworkError extends Error {
  public readonly statusCode?: number | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    statusCode?: number | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'NetworkError'
    this.statusCode = statusCode
    this.recovery = recovery || [
      'Check your internet connection',
      'Verify proxy settings if using a proxy',
      'Try again in a few moments',
    ]
  }
}

/**
 * API rate limit error with quota information. Thrown when API rate limits are
 * exceeded (429).
 */
export class RateLimitError extends Error {
  public readonly retryAfter?: number | undefined
  public readonly recovery: string[]

  constructor(message: string, retryAfter?: number | undefined) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
    this.recovery = [
      retryAfter
        ? `Wait ${retryAfter} seconds before retrying`
        : 'Wait a few minutes before retrying',
      `Check your API quota at ${SOCKET_DASHBOARD_URL}`,
      `Consider upgrading your plan for higher limits at ${SOCKET_PRICING_URL}`,
    ]
  }
}

/**
 * File system error with path context. Thrown when file operations fail.
 */
export class FileSystemError extends Error {
  public readonly path?: string | undefined
  public readonly code?: string | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    path?: string | undefined,
    code?: string | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'FileSystemError'
    this.path = path
    this.code = code
    this.recovery = recovery || this.getDefaultRecovery(code)
  }

  private getDefaultRecovery(code?: string): string[] {
    switch (code) {
      case 'ENOENT':
        return [
          'Verify the file or directory exists',
          'Check the path spelling',
          'Ensure you have permission to access the location',
        ]
      case 'EACCES':
      case 'EPERM':
        return [
          'Check file permissions',
          'Run with appropriate user privileges',
          'Verify directory ownership',
        ]
      case 'ENOSPC':
        return [
          'Free up disk space',
          'Check available disk space with `df -h`',
          'Clear out anything you no longer need on disk',
        ]
      default:
        return ['Check file system permissions and availability']
    }
  }
}

/**
 * Configuration error with setup instructions. Thrown when CLI configuration is
 * invalid or missing.
 */
export class ConfigError extends Error {
  public readonly configKey?: string | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    configKey?: string | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'ConfigError'
    this.configKey = configKey
    this.recovery = recovery || [
      'Run `socket config list` to view current configuration',
      'Use `socket config set <key> <value>` to update settings',
      'Check ~/.config/socket/config.toml for syntax errors',
    ]
  }
}

/**
 * Timeout error with retry guidance. Thrown when operations exceed time limits.
 */
export class TimeoutError extends Error {
  public readonly timeoutMs?: number | undefined
  public readonly elapsedMs?: number | undefined
  public readonly recovery: string[]

  constructor(
    message: string,
    timeoutMs?: number | undefined,
    elapsedMs?: number | undefined,
    recovery?: string[] | undefined,
  ) {
    super(message)
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
    this.elapsedMs = elapsedMs
    this.recovery = recovery || [
      'Check your internet connection speed',
      'Try again when network conditions improve',
      'Contact support if timeouts persist',
    ]
  }
}
