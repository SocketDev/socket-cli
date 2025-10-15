/**
 * @fileoverview Build output formatting utilities
 *
 * Centralized output formatting for build script.
 */

import { logger } from '@socketsecurity/registry/lib/logger'

/**
 * Print section header.
 */
export function printHeader(title) {
  logger.log('')
  logger.log('━'.repeat(60))
  logger.log(`  ${title}`)
  logger.log('━'.repeat(60))
  logger.log('')
}

/**
 * Print error with instructions.
 */
export function printError(title, message, instructions = []) {
  logger.error('')
  logger.error('❌', title)
  logger.error('')
  logger.error(message)
  if (instructions.length > 0) {
    logger.error('')
    logger.error('What to do:')
    for (const instruction of instructions) {
      logger.error(`  • ${instruction}`)
    }
  }
  logger.error('')
}

/**
 * Print warning with suggestions.
 */
export function printWarning(title, message, suggestions = []) {
  logger.warn('')
  logger.warn('⚠️ ', title)
  logger.warn('')
  logger.warn(message)
  if (suggestions.length > 0) {
    logger.warn('')
    logger.warn('Suggestions:')
    for (const suggestion of suggestions) {
      logger.warn(`  • ${suggestion}`)
    }
  }
  logger.warn('')
}

/**
 * Print success message.
 */
export function printSuccess(message) {
  logger.log(`✅ ${message}`)
}

/**
 * Print info message.
 */
export function printInfo(message) {
  logger.log(`ℹ️  ${message}`)
}

/**
 * Print step with description.
 */
export function printStep(step, total, description) {
  logger.log(`[${step}/${total}] ${description}`)
}
