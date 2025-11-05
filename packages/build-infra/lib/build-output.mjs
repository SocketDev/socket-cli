/**
 * Build Output Utilities
 *
 * Provides consistent, pretty logging for build processes.
 */

import loggerPkg from '@socketsecurity/lib-external/logger'

const logger = loggerPkg.getDefaultLogger()

/**
 * Print header.
 */
export function printHeader(message) {
  logger.step(message)
}

/**
 * Print step.
 */
export function printStep(message) {
  logger.substep(message)
}

/**
 * Print substep.
 */
export function printSubstep(message) {
  logger.info(`  ${message}`)
}

/**
 * Print success message.
 */
export function printSuccess(message) {
  logger.success(message)
}

/**
 * Print error message.
 */
export function printError(message, error = null) {
  logger.error(message)
  if (error) {
    logger.error(error.message)
    if (error.stack) {
      logger.error(error.stack)
    }
  }
}

/**
 * Print warning message.
 */
export function printWarning(message) {
  logger.warn(message)
}
