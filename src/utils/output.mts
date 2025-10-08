/** @fileoverview Output utilities for Socket CLI. Provides conditional logging helpers that respect output format (JSON vs text). */

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from './fail-msg-with-badge.mts'
import { serializeResultJson } from './serialize-result-json.mts'

import type { CResult, OutputKind } from '../types.mts'

/**
 * Conditionally log info message.
 */
export function logInfoIf(outputKind: OutputKind, message: string): void {
  if (outputKind !== 'json') {
    logger.info(message)
  }
}

/**
 * Conditionally log success message.
 */
export function logSuccessIf(outputKind: OutputKind, message: string): void {
  if (outputKind !== 'json') {
    logger.success(message)
  }
}

/**
 * Conditionally log warn message.
 */
export function logWarnIf(outputKind: OutputKind, message: string): void {
  if (outputKind !== 'json') {
    logger.warn(message)
  }
}

/**
 * Conditionally log error message.
 */
export function logErrorIf(outputKind: OutputKind, message: string): void {
  if (outputKind !== 'json') {
    logger.error(message)
  }
}

/**
 * Conditionally log generic message.
 */
export function logIf(outputKind: OutputKind, message: string): void {
  if (outputKind !== 'json') {
    logger.log(message)
  }
}

/**
 * Generic result output handler that consolidates the common pattern of:
 * - Setting process.exitCode on errors
 * - JSON vs text output branching
 * - Error formatting with failMsgWithBadge
 * - Success message logging
 */
export function outputResult<T>(
  result: CResult<T>,
  outputKind: OutputKind,
  handlers: {
    success: (data: T) => string | Promise<string>
    json?: (result: CResult<T>) => string
    error?: (result: CResult<T>) => string
  },
): void {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    const jsonContent = handlers.json?.(result) ?? serializeResultJson(result)
    // Use console.log directly for JSON output to ensure it's not silenced
    console.log(jsonContent)
    return
  }

  if (!result.ok) {
    const errorMsg =
      handlers.error?.(result) ?? failMsgWithBadge(result.message, result.cause)
    logger.fail(errorMsg)
    return
  }

  const successResult = handlers.success(result.data)
  if (successResult instanceof Promise) {
    successResult.then(msg => {
      if (msg) {
        logger.success(msg)
      }
    })
  } else if (successResult) {
    logger.success(successResult)
  }
}
