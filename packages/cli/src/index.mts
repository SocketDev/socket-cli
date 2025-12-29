/**
 * CLI loader.
 * Loads the built CLI from dist/cli.js.
 *
 * Note: Written as CommonJS to avoid import.meta issues. Shebang added by esbuild banner.
 */

const path = require('node:path')

// Load CLI from dist directory
const cliPath = path.join(__dirname, 'cli.js')
require(cliPath)
