/**
 * Bootstrap for Socket CLI SEA (Single Executable Application) binary.
 *
 * This runs inside the SEA Node.js binary as the main entry point.
 * Downloads @socketsecurity/cli from npm on first run and executes it.
 *
 * Unlike smol builds where bootstrap is embedded in Node.js internals,
 * SEA bootstrap runs as the main application entry point.
 */

// Load Intl polyfill FIRST for ICU-disabled builds (if SEA uses minimal Node.js).
import '@socketsecurity/cli/src/polyfills/intl-stub/index.mts'

import { findAndExecuteCli, getArgs } from './shared/bootstrap-shared.mjs'

/**
 * Check if we should skip CLI bootstrap.
 * Returns true when showing version (no download needed).
 */
function shouldSkipCliBootstrap() {
  // Skip if user just wants to see version (--version or -v).
  // No need to download CLI just to show Node.js version.
  const args = getArgs()
  if (args.includes('--version') || args.includes('-v')) {
    return true
  }

  return false
}

async function main() {
  // Skip preflight CLI download if just showing version.
  if (shouldSkipCliBootstrap()) {
    // Let Node.js handle --version flag.
    return 0
  }

  const args = getArgs()
  return await findAndExecuteCli(args)
}

// Run the bootstrap.
main()
  .then((exitCode) => {
    // Exit with the code returned by the CLI (or 0 if bootstrap was skipped).
    if (exitCode !== 0) {
      process.exit(exitCode)
    }
  })
  .catch((e) => {
    // Use process.stderr.write() directly to avoid console access during early bootstrap.
    process.stderr.write(`Bootstrap error: ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
