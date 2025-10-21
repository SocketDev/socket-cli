/** @fileoverview Utility to suppress specific process warnings. */

const { apply: ReflectApply } = Reflect

// Store the original emitWarning function to avoid repeat wrapping.
let originalEmitWarning

// Track which warning types are currently suppressed.
const suppressedWarnings = new Set()

/**
 * Internal function to set up warning suppression.
 * Only wraps process.emitWarning once, regardless of how many times it's called.
 */
function setupSuppression() {
  // Only wrap once - store the original on first call.
  if (!originalEmitWarning) {
    originalEmitWarning = process.emitWarning
    process.emitWarning = (warning, ...args) => {
      // Check both string warnings and warning objects.
      if (typeof warning === 'string') {
        // Check if any suppressed warning type matches.
        for (const suppressedType of suppressedWarnings) {
          if (warning.includes(suppressedType)) {
            return
          }
        }
      } else if (warning && typeof warning === 'object') {
        const warningName = warning.name
        if (warningName && suppressedWarnings.has(warningName)) {
          return
        }
      }
      // Not suppressed - call the original function.
      return ReflectApply(originalEmitWarning, process, [warning, ...args])
    }
  }
}

/**
 * Suppress MaxListenersExceededWarning messages.
 * This is useful in tests or scripts where multiple listeners are expected.
 */
export function suppressMaxListenersWarning() {
  suppressedWarnings.add('MaxListenersExceededWarning')
  setupSuppression()
}

/**
 * Suppress all process warnings of a specific type.
 *
 * @param {string} warningType - The warning type to suppress (e.g., 'DeprecationWarning', 'ExperimentalWarning')
 */
export function suppressWarningType(warningType) {
  suppressedWarnings.add(warningType)
  setupSuppression()
}

/**
 * Set max listeners on an EventTarget (like AbortSignal) to avoid TypeError.
 *
 * By manually setting `kMaxEventTargetListeners` on the target we avoid:
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "emitter" argument must be an
 *   instance of EventEmitter or EventTarget. Received an instance of
 *   AbortSignal
 *
 * in some patch releases of Node 18-23 when calling events.getMaxListeners().
 * See https://github.com/nodejs/node/pull/56807.
 *
 * Instead of calling events.setMaxListeners(n, target) we set the symbol
 * property directly to avoid depending on 'node:events' module.
 *
 * @param {EventTarget | AbortSignal} target - The EventTarget or AbortSignal to configure
 * @param {number} [maxListeners=10] - Maximum number of listeners (defaults to 10, the Node.js default)
 */
export function setMaxEventTargetListeners(target, maxListeners = 10) {
  const symbols = Object.getOwnPropertySymbols(target)
  const kMaxEventTargetListeners = symbols.find(
    s => s.description === 'events.maxEventTargetListeners',
  )
  if (kMaxEventTargetListeners) {
    // The default events.defaultMaxListeners value is 10.
    // https://nodejs.org/api/events.html#eventsdefaultmaxlisteners
    target[kMaxEventTargetListeners] = maxListeners
  }
}

/**
 * Restore the original process.emitWarning function.
 * Call this to re-enable all warnings after suppressing them.
 */
export function restoreWarnings() {
  if (originalEmitWarning) {
    process.emitWarning = originalEmitWarning
    originalEmitWarning = undefined
    suppressedWarnings.clear()
  }
}

/**
 * Suppress warnings temporarily within a callback.
 *
 * @param {string} warningType - The warning type to suppress
 * @param {Function} callback - Function to execute with warnings suppressed
 * @returns {Promise<*>} The result of the callback
 */
export async function withSuppressedWarnings(warningType, callback) {
  const original = process.emitWarning
  suppressWarningType(warningType)
  try {
    return await callback()
  } finally {
    process.emitWarning = original
  }
}
