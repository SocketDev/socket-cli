/**
 * Debug stub - stubs out debug logging.
 *
 * Many npm packages include debug() calls for verbose logging.
 * In production, these are disabled via process.env.DEBUG.
 * This stub removes the debug module entirely.
 *
 * Used by: Various npm packages
 * Savings: ~9KB + removes debug dependency checks
 */
'use strict'

// Return a no-op function that accepts any arguments
function debug() {
  return function noop() {}
}

// Common debug properties
debug.enabled = false
debug.names = []
debug.skips = []
debug.formatters = {}

module.exports = debug
