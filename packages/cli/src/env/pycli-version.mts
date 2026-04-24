/**
 * PyCLI version getter function.
 * Uses direct process.env access so esbuild define can inline values.
 * IMPORTANT: esbuild's define plugin can only replace direct process.env['KEY'] references.
 * If we imported from env modules, esbuild couldn't inline the values at build time.
 * This is critical for embedding version info into the binary.
 */

import process from 'node:process'

/**
 * Get the Socket Python CLI version (socketsecurity package) that should be installed.
 * This version is inlined at build time from bundle-tools.json.
 *
 * @returns Socket Python CLI version string (e.g., "0.8.0").
 * @throws Error if version is not inlined at build time.
 */
export function getPyCliVersion(): string {
  const version = process.env['INLINED_PYCLI_VERSION']
  if (!version) {
    throw new Error(
      `process.env.INLINED_PYCLI_VERSION is empty at runtime; this value should be inlined at build time from bundle-tools.json tools.socketsecurity.version (PyPI package) — rebuild socket-cli (\`pnpm run build:cli\`) or check that esbuild's define step ran`,
    )
  }
  return version
}
