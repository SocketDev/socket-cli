/**
 * Build Output Utilities
 *
 * Provides consistent, pretty logging for build processes.
 */

import loggerPkg from '@socketsecurity/lib/logger'
const { getDefaultLogger } = loggerPkg

/**
 * Print header.
 */
export function printHeader(message) {
  getDefaultLogger().step(message)
}

/**
 * Print step.
 */
export function printStep(message) {
  getDefaultLogger().substep(message)
}

/**
 * Print substep.
 */
export function printSubstep(message) {
  getDefaultLogger().info(`  ${message}`)
}

/**
 * Print success message.
 */
export function printSuccess(message) {
  getDefaultLogger().success(message)
}

/**
 * Print error message.
 */
export function printError(message, error = null) {
  getDefaultLogger().error(message)
  if (error) {
    getDefaultLogger().error(error.message)
    if (error.stack) {
      getDefaultLogger().error(error.stack)
    }
  }
}

/**
 * Print warning message.
 */
export function printWarning(message) {
  getDefaultLogger().warn(message)
}
