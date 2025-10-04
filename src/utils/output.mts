/** @fileoverview Output utilities for Socket CLI. Provides conditional logging helpers that respect output format (JSON vs text). */

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../types.mts'

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
