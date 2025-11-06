/**
 * CLI loader entry point.
 * Loads and executes the CLI bundle.
 *
 * Note: Written as CommonJS to avoid import.meta issues. Shebang added by esbuild banner.
 */

// CommonJS globals are available since we're outputting to CJS format.
const path = require('node:path')

const cliPath = path.join(__dirname, 'cli.js')

// Load and execute the CLI module.
require(cliPath)
