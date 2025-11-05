/**
 * Brotli-compressed bootstrap loader.
 * Decompresses and executes the appropriate bootstrap based on environment.
 *
 * This loader reduces package size by keeping bootstraps compressed.
 * Pattern follows packages/cli/src/index.mts design.
 *
 * Note: Written as CommonJS to avoid import.meta issues. Shebang omitted (not executable).
 */

// CommonJS globals are available since we're outputting to CJS format.
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { brotliDecompressSync } = require('node:zlib')

/**
 * Load and execute a compressed bootstrap.
 *
 * @param {string} bootstrapName - Name of bootstrap file (without .br extension)
 * @returns {any} Bootstrap module exports
 */
function loadBootstrap(bootstrapName) {
  const bootstrapBrPath = path.join(__dirname, `${bootstrapName}.br`)

  // Read and decompress.
  const compressed = readFileSync(bootstrapBrPath)
  const decompressed = brotliDecompressSync(compressed)

  // Create a new module and compile the decompressed code.
  const Module = require('node:module')
  const bootstrapModule = new Module(bootstrapBrPath, module)
  bootstrapModule.filename = bootstrapBrPath
  bootstrapModule.paths = Module._nodeModulePaths(__dirname)

  // Compile and load the bootstrap module.
  bootstrapModule._compile(decompressed.toString('utf-8'), bootstrapBrPath)

  return bootstrapModule.exports
}

// Export loader functions for each bootstrap type.
module.exports = {
  /**
   * Load npm bootstrap (for socket-npm wrapper).
   * @returns {any} Bootstrap exports
   */
  loadNpmBootstrap() {
    return loadBootstrap('bootstrap-npm.js')
  },

  /**
   * Load SEA bootstrap (for Single Executable Application).
   * @returns {any} Bootstrap exports
   */
  loadSeaBootstrap() {
    return loadBootstrap('bootstrap-sea.js')
  },

  // Re-export the loader function for custom usage.
  loadBootstrap,
}
