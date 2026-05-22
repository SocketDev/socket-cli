/**
 * @file Error display utilities with polished formatting.
 */

import colors from 'yoctocolors-cjs'

import { messageWithCauses } from '@socketsecurity/lib-stable/errors'
import { isError } from '@socketsecurity/lib-stable/errors/predicates'
import { LOG_SYMBOLS } from '@socketsecurity/lib-stable/logger/symbols'
import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'

import { isDebugNs } from '../debug.mts'
import {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError,
  getRecoverySuggestions,
} from './errors.mts'

import type { CResult } from '../../types.mjs'

type ErrorDisplayOptions = {
  cause?: string | undefined
  showStack?: boolean | undefined
  title?: string | undefined
  verbose?: boolean | undefined
}

/**
 * Append the `.cause` chain to a decorated base message. Typed errors build
 * their message with suffixes (e.g. ` (HTTP 500)`) before this is called, so we
 * can't just `messageWithCauses(error)` — we decorate first, then delegate
 * cause walking to socket-lib.
 */
export function appendCauseChain(baseMessage: string, cause: unknown): string {
  if (!cause) {
    return baseMessage
  }
  const causeText = isError(cause) ? messageWithCauses(cause) : String(cause)
  return `${baseMessage}: ${causeText}`
}

/**
 * Format an error for display with polish and clarity. Uses LOG_SYMBOLS and
 * colors for visual hierarchy.
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
    message = appendCauseChain(message, error.cause)
  } else if (error instanceof AuthError) {
    title = 'Authentication error'
    message = appendCauseChain(error.message, error.cause)
  } else if (error instanceof NetworkError) {
    title = 'Network error'
    message = error.message
    if (error.statusCode) {
      message += ` (HTTP ${error.statusCode})`
    }
    message = appendCauseChain(message, error.cause)
  } else if (error instanceof FileSystemError) {
    title = 'File system error'
    message = error.message
    if (error.path) {
      message += ` (${error.path})`
    }
    message = appendCauseChain(message, error.cause)
  } else if (error instanceof ConfigError) {
    title = 'Configuration error'
    message = error.message
    if (error.configKey) {
      message += ` (key: ${error.configKey})`
    }
    message = appendCauseChain(message, error.cause)
  } else if (error instanceof InputError) {
    title = 'Invalid input'
    message = appendCauseChain(error.message, error.cause)
    body = error.body
  } else if (isError(error)) {
    title = opts.title || 'Unexpected error'
    message = appendCauseChain(error.message, error.cause)

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
        // Use .message (or String coercion) here — errorMessage() walks
        // the entire remaining cause chain via messageWithCauses, which
        // would duplicate messages since the outer while loop is already
        // iterating the chain level-by-level.
        const causeMessage = isError(currentCause)
          ? currentCause.message || String(currentCause)
          : String(currentCause)

        causeLines.push(
          `\n${colors.dim(`Caused by [${depth}]:`)} ${colors.yellow(causeMessage)}`,
        )

        if (isError(currentCause) && currentCause.stack && depth === 1) {
          const causeStack = currentCause.stack
            .split('\n')
            .slice(1)
            .map(line => `  ${colors.dim(line.trim())}`)
            .join('\n')
          causeLines.push(causeStack)
        }

        currentCause = isError(currentCause) ? currentCause.cause : undefined
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
 * Format error for JSON output. Provides structured error data for machine
 * consumption.
 */
export function formatErrorForJson(
  error: unknown,
  options?: ErrorDisplayOptions | undefined,
): CResult<never> & { recovery?: string[] | undefined } {
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
 * Format error for terminal display with visual hierarchy. Returns formatted
 * string ready to log to stderr.
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
    for (let i = 0, { length } = recovery; i < length; i += 1) {
      const suggestion = recovery[i]
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

