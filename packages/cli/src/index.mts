/**
 * Brotli-compressed CLI loader.
 * Decompresses dist/cli.js.bz and executes it.
 *
 * This loader allows the CLI to be distributed as a compressed file,
 * reducing npm package size from ~13MB to ~1.7MB.
 *
 * Note: Written as CommonJS to avoid import.meta issues. Shebang added by esbuild banner.
 */

// CommonJS globals are available since we're outputting to CJS format.
const {
  readFileSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { safeMkdirSync } = require('@socketsecurity/lib/fs')
const Module = require('node:module')
const path = require('node:path')
const { brotliDecompressSync } = require('node:zlib')

const cliBzPath = path.join(__dirname, 'cli.js.bz')
const buildPath = path.join(__dirname, '..', 'build')

// Read and decompress.
const compressed = readFileSync(cliBzPath)
const decompressed = brotliDecompressSync(compressed)

// Ensure build/ directory exists.
safeMkdirSync(buildPath, { recursive: true })

// Write to build/ directory (gitignored, local to package).
const tempCliPath = path.join(buildPath, `cli-runtime-${process.pid}.js`)
writeFileSync(tempCliPath, decompressed)

try {
  // Create a new module and set its paths to resolve from the CLI package directory.
  const cliModule = new Module(tempCliPath, module.parent)
  cliModule.filename = tempCliPath
  cliModule.paths = Module._nodeModulePaths(__dirname)

  // Load and execute the CLI module.
  cliModule._compile(decompressed.toString('utf-8'), tempCliPath)
} finally {
  // Clean up temp file.
  try {
    unlinkSync(tempCliPath)
  } catch {
    // Ignore cleanup errors.
  }
}
