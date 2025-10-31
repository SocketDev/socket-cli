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

async function main() {
  const args = getArgs()
  return await findAndExecuteCli(args)
}

// Run the bootstrap.
main()
  .then((exitCode) => {
    // Exit with the code returned by the CLI.
    process.exit(exitCode)
  })
  .catch((e) => {
    // Use process.stderr.write() directly to avoid console access during early bootstrap.
    const errorMsg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`Bootstrap error: ${errorMsg}\n`)
    process.exit(1)
  })
