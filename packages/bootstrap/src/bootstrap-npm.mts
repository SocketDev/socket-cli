/**
 * Bootstrap for Socket CLI npm wrapper.
 *
 * This runs when users execute `npx socket` or `npm install -g socket`.
 * It downloads @socketsecurity/cli from npm and executes it.
 */

// Load Intl polyfill FIRST for ICU-disabled builds.
import '@socketsecurity/cli/src/polyfills/intl-stub/index.mts'

import { logger } from '@socketsecurity/lib/logger'

import { findAndExecuteCli, getArgs } from './shared/bootstrap-shared.mjs'

async function main() {
  const args = getArgs()
  await findAndExecuteCli(args)
}

// Run the bootstrap.
main().catch((e) => {
  logger.error(`Bootstrap error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
