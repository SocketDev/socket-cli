/** @fileoverview Utility to suppress specific process warnings. */

/**
 * Suppress MaxListenersExceededWarning messages.
 */
export function suppressMaxListenersWarning() {
  const originalWarning = process.emitWarning
  process.emitWarning = (warning, ...args) => {
    if (
      typeof warning === 'string' &&
      warning.includes('MaxListenersExceededWarning')
    ) {
      // Suppress MaxListeners warnings.
      return
    }
    return originalWarning.call(process, warning, ...args)
  }
}
