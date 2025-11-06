/** @fileoverview Vitest setup file for coverage mode require() interception. */

// Check if coverage is enabled.
const isCoverageEnabled =
  process.argv.includes('--coverage') || process.env.COVERAGE === 'true'

if (isCoverageEnabled) {
  // Intercept require() calls to redirect registry/dist to registry/src.
  const Module = require('node:module')
  const originalRequire = Module.prototype.require

  Module.prototype.require = function (id: string) {
    // Redirect registry/dist to registry/src for coverage.
    if (typeof id === 'string' && id.includes('/registry/dist/')) {
      const srcPath = id
        .replace(/\/registry\/dist\//, '/registry/src/')
        .replace(/\.js$/, '.ts')

      // Try to resolve the src path.
      try {
        return originalRequire.call(this, srcPath)
      } catch {
        // Fall back to original if src doesn't exist.
      }
    }

    return originalRequire.call(this, id)
  }
}
