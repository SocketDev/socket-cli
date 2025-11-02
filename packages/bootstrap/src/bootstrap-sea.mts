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

import { findAndExecuteCli, getArgs, SOCKET_CLI_VERSION } from './shared/bootstrap-shared.mjs'

async function main() {
  const args = getArgs()

  // Check if user wants to see version.
  if (args.includes('--version') || args.includes('-v')) {
    console.log(SOCKET_CLI_VERSION)
    return 0
  }

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
