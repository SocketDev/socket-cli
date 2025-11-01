/**
 * @fileoverview Build output formatting utilities
 *
 * Centralized output formatting for build script.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

/**
 * Print section header.
 */
export function printHeader(title) {
  getDefaultLogger().log('')
  getDefaultLogger().log('━'.repeat(60))
  getDefaultLogger().log(`  ${title}`)
  getDefaultLogger().log('━'.repeat(60))
  getDefaultLogger().log('')
}

/**
 * Print error with instructions.
 */
export function printError(title, message, instructions = []) {
  getDefaultLogger().error('')
  getDefaultLogger().error('❌', title)
  getDefaultLogger().error('')
  getDefaultLogger().error(message)
  if (instructions.length > 0) {
    getDefaultLogger().error('')
    getDefaultLogger().error('What to do:')
    for (const instruction of instructions) {
      getDefaultLogger().error(`  • ${instruction}`)
    }
  }
  getDefaultLogger().error('')
}

/**
 * Print warning with suggestions.
 */
export function printWarning(title, message, suggestions = []) {
  getDefaultLogger().warn('')
  getDefaultLogger().warn('⚠️ ', title)
  getDefaultLogger().warn('')
  getDefaultLogger().warn(message)
  if (suggestions.length > 0) {
    getDefaultLogger().warn('')
    getDefaultLogger().warn('Suggestions:')
    for (const suggestion of suggestions) {
      getDefaultLogger().warn(`  • ${suggestion}`)
    }
  }
  getDefaultLogger().warn('')
}

/**
 * Print success message.
 */
export function printSuccess(message) {
  getDefaultLogger().log(`✅ ${message}`)
}

/**
 * Print info message.
 */
export function printInfo(message) {
  getDefaultLogger().log(`ℹ️  ${message}`)
}

/**
 * Print step with description.
 */
export function printStep(step, total, description) {
  getDefaultLogger().log(`[${step}/${total}] ${description}`)
}
