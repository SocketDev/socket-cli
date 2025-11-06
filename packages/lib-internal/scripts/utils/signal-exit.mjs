/**
 * @fileoverview Simplified signal exit handler for build scripts.
 *
 * This is intentionally separate from src/lib/signal-exit.ts to avoid circular
 * dependencies where build scripts depend on the built dist output.
 */

/**
 * Register a callback to run when process exits
 *
 * @param {(code: number, signal: string | null) => void} callback
 * @returns {() => void} Cleanup function
 */
export function onExit(callback) {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']

  const handler = signal => {
    callback(process.exitCode || 0, signal)
  }

  const exitHandler = () => {
    callback(process.exitCode || 0, null)
  }

  signals.forEach(signal => {
    process.on(signal, handler)
  })

  process.on('exit', exitHandler)

  // Return cleanup function
  return () => {
    signals.forEach(signal => {
      process.off(signal, handler)
    })
    process.off('exit', exitHandler)
  }
}
