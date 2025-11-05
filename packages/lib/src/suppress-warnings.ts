/**
 * @fileoverview Utilities to suppress specific process warnings.
 */

const { apply: ReflectApply } = Reflect

// Store the original emitWarning function to avoid repeat wrapping.
let originalEmitWarning: typeof process.emitWarning | undefined

// Track which warning types are currently suppressed.
const suppressedWarnings = new Set<string>()

/**
 * Internal function to set up warning suppression.
 * Only wraps process.emitWarning once, regardless of how many times it's called.
 */
function setupSuppression(): void {
  // Only wrap once - store the original on first call.
  if (!originalEmitWarning) {
    originalEmitWarning = process.emitWarning
    process.emitWarning = (warning: string | Error, ...args: any[]) => {
      // Check both string warnings and warning objects.
      if (typeof warning === 'string') {
        // Check if any suppressed warning type matches.
        for (const suppressedType of suppressedWarnings) {
          if (warning.includes(suppressedType)) {
            return
          }
        }
      } else if (warning && typeof warning === 'object') {
        const warningObj = warning as { name?: string }
        if (warningObj.name && suppressedWarnings.has(warningObj.name)) {
          return
        }
      }
      // Not suppressed - call the original function.
      return ReflectApply(
        originalEmitWarning as typeof process.emitWarning,
        process,
        [warning, ...args],
      )
    }
  }
}

/**
 * Suppress MaxListenersExceededWarning messages.
 * This is useful in tests or scripts where multiple listeners are expected.
 *
 * @example
 * import { suppressMaxListenersWarning } from '@socketsecurity/lib/suppress-warnings'
 *
 * suppressMaxListenersWarning()
 */
export function suppressMaxListenersWarning(): void {
  suppressedWarnings.add('MaxListenersExceededWarning')
  setupSuppression()
}

/**
 * Suppress all process warnings of a specific type.
 *
 * @param warningType - The warning type to suppress (e.g., 'DeprecationWarning', 'ExperimentalWarning')
 *
 * @example
 * import { suppressWarningType } from '@socketsecurity/lib/suppress-warnings'
 *
 * suppressWarningType('ExperimentalWarning')
 */
export function suppressWarningType(warningType: string): void {
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
 * @param target - The EventTarget or AbortSignal to configure
 * @param maxListeners - Maximum number of listeners (defaults to 10, the Node.js default)
 *
 * @example
 * import { setMaxEventTargetListeners } from '@socketsecurity/lib/suppress-warnings'
 *
 * const controller = new AbortController()
 * setMaxEventTargetListeners(controller.signal)
 */
export function setMaxEventTargetListeners(
  target: EventTarget | AbortSignal | undefined,
  maxListeners: number = 10,
): void {
  if (!target) {
    return
  }
  const symbols = Object.getOwnPropertySymbols(target)
  const kMaxEventTargetListeners = symbols.find(
    s => s.description === 'events.maxEventTargetListeners',
  )
  if (kMaxEventTargetListeners) {
    // The default events.defaultMaxListeners value is 10.
    // https://nodejs.org/api/events.html#eventsdefaultmaxlisteners
    ;(target as any)[kMaxEventTargetListeners] = maxListeners
  }
}

/**
 * Restore the original process.emitWarning function.
 * Call this to re-enable all warnings after suppressing them.
 */
export function restoreWarnings(): void {
  if (originalEmitWarning) {
    process.emitWarning = originalEmitWarning
    originalEmitWarning = undefined
    suppressedWarnings.clear()
  }
}

/**
 * Suppress warnings temporarily within a callback.
 *
 * @param warningType - The warning type to suppress
 * @param callback - Function to execute with warnings suppressed
 * @returns The result of the callback
 *
 * @example
 * import { withSuppressedWarnings } from '@socketsecurity/lib/suppress-warnings'
 *
 * const result = await withSuppressedWarnings('ExperimentalWarning', async () => {
 *   // Code that triggers experimental warnings
 *   return someValue
 * })
 */
export async function withSuppressedWarnings<T>(
  warningType: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  const original = process.emitWarning
  suppressWarningType(warningType)
  try {
    return await callback()
  } finally {
    process.emitWarning = original
  }
}
