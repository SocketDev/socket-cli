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

import { logger } from '@socketsecurity/lib/logger'

import { findAndExecuteCli, getArgs } from './shared/bootstrap-shared.mjs'

async function main() {
  const args = getArgs()
  await findAndExecuteCli(args)
}

// Run the bootstrap.
// Note: Logger now uses lazy Console initialization, so it's safe to import
// during early bootstrap. The Console is only created on first use.
main().catch((e) => {
  logger.error(`Bootstrap error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
