/**
 * Throw stub - errors if called.
 * Used for dependencies that should never be reached in production.
 * Helps catch bugs if accidentally called.
 */
'use strict'

function throwStub(moduleName) {
  throw new Error(
    `Module '${moduleName}' is stubbed and should not be called. ` +
      'This is likely a bundling error or unexpected code path.',
  )
}

module.exports = throwStub
