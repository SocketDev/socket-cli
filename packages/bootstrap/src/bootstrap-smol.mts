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
 * Check if we should skip CLI bootstrap.
 * Returns true for build tests or when showing version (no download needed).
 */
function shouldSkipCliBootstrap() {
  // Skip if this is a build smoke test (binary verification during compilation).
  // The CLI version doesn't exist on npm yet during build, so we can't download it.
  if (process.env.SOCKET_CLI_BUILD_TEST === '1' ||
      process.env.SOCKET_CLI_BUILD_TEST === 'true') {
    return true
  }

  // Skip if user just wants to see version (--version or -v).
  // No need to download CLI just to show Node.js version.
  const args = getArgs()
  if (args.includes('--version') || args.includes('-v')) {
    return true
  }

  return false
}

async function main() {
  // Skip bootstrap if we're in a build/test environment.
  // During smol binary compilation, smoke tests verify Node.js works,
  // but the CLI version doesn't exist on npm yet, so we can't download it.
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
