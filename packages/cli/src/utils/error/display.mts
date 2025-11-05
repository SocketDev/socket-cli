/** @fileoverview Error display utilities with polished formatting. */

import colors from 'yoctocolors-cjs'

import { LOG_SYMBOLS } from '@socketsecurity/lib-internal/logger'
import { stripAnsi } from '@socketsecurity/lib-internal/strings'

import { debugNs, isDebugNs } from '../debug.mts'
import {
  AuthError,
  ConfigError,
  FileSystemError,
  getRecoverySuggestions,
  InputError,
  NetworkError,
  RateLimitError,
} from './errors.mts'

import type { CResult } from '../../types.mjs'

export type ErrorDisplayOptions = {
  cause?: string | undefined
  showStack?: boolean | undefined
  title?: string | undefined
  verbose?: boolean | undefined
}

/**
 * Format an error for display with polish and clarity.
 * Uses LOG_SYMBOLS and colors for visual hierarchy.
 */
export function formatErrorForDisplay(
  error: unknown,
  options?: ErrorDisplayOptions | undefined,
): { body?: string | undefined; message: string; title: string } {
  const opts = { __proto__: null, ...options } as ErrorDisplayOptions
  const verbose = opts.verbose ?? isDebugNs('error')
  const showStack = opts.showStack ?? verbose

  let title = opts.title || 'Error'
  let message = ''
  let body: string | undefined

  if (error instanceof RateLimitError) {
    title = 'API rate limit exceeded'
    message = error.message
    if (error.retryAfter) {
      message += ` (retry after ${error.retryAfter}s)`
    }
  } else if (error instanceof AuthError) {
    title = 'Authentication error'
    message = error.message
  } else if (error instanceof NetworkError) {
    title = 'Network error'
    message = error.message
    if (error.statusCode) {
      message += ` (HTTP ${error.statusCode})`
    }
  } else if (error instanceof FileSystemError) {
    title = 'File system error'
    message = error.message
    if (error.path) {
      message += ` (${error.path})`
    }
  } else if (error instanceof ConfigError) {
    title = 'Configuration error'
    message = error.message
    if (error.configKey) {
      message += ` (key: ${error.configKey})`
    }
  } else if (error instanceof InputError) {
    title = 'Invalid input'
    message = error.message
    body = error.body
  } else if (error instanceof Error) {
    title = opts.title || 'Unexpected error'
    message = error.message

    if (showStack && error.stack) {
      // Format stack trace with proper indentation.
      const stackLines = error.stack.split('\n')
      const formattedStack = stackLines
        .slice(1)
        .map(line => `  ${colors.dim(line.trim())}`)
        .join('\n')

      body = formattedStack
    }

    // Handle error causes (chain of errors).
    if (error.cause && showStack) {
      const causeLines = []
      let currentCause: unknown = error.cause
      let depth = 1

      while (currentCause && depth <= 5) {
        const causeMessage =
          currentCause instanceof Error
            ? currentCause.message
            : String(currentCause)

        causeLines.push(
          `\n${colors.dim(`Caused by [${depth}]:`)} ${colors.yellow(causeMessage)}`,
        )

        if (
          currentCause instanceof Error &&
          currentCause.stack &&
          depth === 1
        ) {
          const causeStack = currentCause.stack
            .split('\n')
            .slice(1)
            .map(line => `  ${colors.dim(line.trim())}`)
            .join('\n')
          causeLines.push(causeStack)
        }

        currentCause =
          currentCause instanceof Error ? currentCause.cause : undefined
        depth++
      }

      body = body ? `${body}${causeLines.join('\n')}` : causeLines.join('\n')
    }
  } else if (typeof error === 'string') {
    message = error
  } else {
    title = 'Unexpected error'
    message = 'An unknown error occurred'
    if (verbose) {
      body = String(error)
    }
  }

  // Add cause from options if provided.
  if (opts.cause && !body) {
    body = opts.cause
  }

  return { body, message, title }
}

/**
 * Format error as compact single-line summary.
 * Perfect for inline error display without overwhelming output.
 */
export function formatErrorCompact(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}

/**
 * Format error for terminal display with visual hierarchy.
 * Returns formatted string ready to log to stderr.
 */
export function formatErrorForTerminal(
  error: unknown,
  options?: ErrorDisplayOptions | undefined,
): string {
  const { body, message, title } = formatErrorForDisplay(error, options)

  const lines = [
    `${LOG_SYMBOLS['error']} ${colors.red(colors.bold(title))}`,
    message ? `  ${message}` : '',
  ]

  // Add recovery suggestions if available
  const recovery = getRecoverySuggestions(error)
  if (recovery.length > 0) {
    lines.push('', colors.cyan('Suggested actions:'))
    for (const suggestion of recovery) {
      lines.push(`  ${colors.dim('•')} ${suggestion}`)
    }
  }

  if (body) {
    const verbose = options?.verbose ?? isDebugNs('error')
    if (verbose) {
      lines.push('', colors.dim('Stack trace:'), body)
    } else {
      lines.push(
        '',
        colors.dim('Run with DEBUG=1 or --verbose for full stack trace'),
      )
    }
  }

  return lines.filter(Boolean).join('\n')
}

/**
 * Format error for JSON output.
 * Provides structured error data for machine consumption.
 */
export function formatErrorForJson(
  error: unknown,
  options?: ErrorDisplayOptions | undefined,
): CResult<never> & { recovery?: string[] } {
  const { body, message, title } = formatErrorForDisplay(error, {
    ...options,
    showStack: false,
  })

  const recovery = getRecoverySuggestions(error)

  return {
    ok: false,
    cause: stripAnsi(body || message),
    message: stripAnsi(title),
    ...(recovery.length > 0 ? { recovery } : {}),
  }
}

/**
 * Format external CLI error with normalized output.
 * Handles errors from cdxgen, coana, and other external tools.
 */
export function formatExternalCliError(
  command: string,
  error: unknown,
  options?: ErrorDisplayOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as ErrorDisplayOptions

  // Extract stderr if available.
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr)
      : undefined

  // Extract exit code if available.
  const exitCode =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : undefined

  const lines = [
    `${LOG_SYMBOLS['error']} ${colors.red(colors.bold(`Command failed: ${command}`))}`,
  ]

  if (exitCode) {
    lines.push(
      `  ${colors.dim('Exit code:')} ${colors.yellow(String(exitCode))}`,
    )
  }

  if (stderr) {
    const stderrLines = stderr
      .trim()
      .split('\n')
      .map(line => `  ${line}`)
    lines.push('', colors.dim('Error output:'), ...stderrLines)
  } else if (error instanceof Error) {
    lines.push(`  ${error.message}`)
  }

  if (opts.verbose ?? isDebugNs('error')) {
    debugNs('error', `External CLI error details: ${command}`, error)
  }

  return lines.join('\n')
}

/**
 * Format warning message with visual hierarchy.
 */
export function formatWarning(
  message: string,
  details?: string | undefined,
): string {
  const lines = [`${LOG_SYMBOLS['warning']} ${colors.yellow(message)}`]

  if (details) {
    lines.push(`  ${colors.dim(details)}`)
  }

  return lines.join('\n')
}

/**
 * Format success message with visual hierarchy.
 */
export function formatSuccess(
  message: string,
  details?: string | undefined,
): string {
  const lines = [`${LOG_SYMBOLS['success']} ${colors.green(message)}`]

  if (details) {
    lines.push(`  ${colors.dim(details)}`)
  }

  return lines.join('\n')
}

/**
 * Format info message with visual hierarchy.
 */
export function formatInfo(
  message: string,
  details?: string | undefined,
): string {
  const lines = [`${LOG_SYMBOLS['info']} ${colors.blue(message)}`]

  if (details) {
    lines.push(`  ${colors.dim(details)}`)
  }

  return lines.join('\n')
}
