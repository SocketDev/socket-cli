/**
 * Bootstrap for Socket CLI smol binary.
 *
 * This runs inside the smol Node.js binary via internal bootstrap.
 * Uses Node.js internal/* requires (transformed by esbuild plugin).
 *
 * The smol binary loads this at startup via lib/internal/process/pre_execution.js.
 */

// Load Intl polyfill FIRST for ICU-disabled builds (smol Node.js).
import '@socketsecurity/cli/src/polyfills/intl-stub/index.mts'

import { findAndExecuteCli, getArgs } from './shared/bootstrap-shared.mjs'

/**
 * Check if Node.js is being used for non-CLI purposes.
 * Returns true if we should skip CLI bootstrap and let Node.js run normally.
 */
function shouldSkipCliBootstrap() {
  const args = process.execArgv.concat(getArgs())

  // Skip if running in eval mode (node -e '...')
  if (args.includes('-e') || args.includes('--eval')) {
    return true
  }

  // Skip if checking version
  if (args.includes('--version') || args.includes('-v')) {
    return true
  }

  // Skip if printing help
  if (args.includes('--help') || args.includes('-h')) {
    return true
  }

  // Skip if running REPL (no arguments)
  if (args.length === 0) {
    return true
  }

  // Skip if SOCKET_CLI_SKIP_BOOTSTRAP is set (for testing/debugging)
  if (process.env.SOCKET_CLI_SKIP_BOOTSTRAP === '1' ||
      process.env.SOCKET_CLI_SKIP_BOOTSTRAP === 'true') {
    return true
  }

  return false
}

async function main() {
  // Skip bootstrap if Node.js is being used for non-CLI purposes.
  if (shouldSkipCliBootstrap()) {
    // Let Node.js continue with its normal execution.
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
    const errorMsg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`Bootstrap error: ${errorMsg}\n`)
    process.exit(1)
  })
