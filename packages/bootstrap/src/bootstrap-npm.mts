/**
 * Bootstrap for Socket CLI npm wrapper.
 *
 * This runs when users execute `npx socket` or `npm install -g socket`.
 * It downloads @socketsecurity/cli from npm and executes it.
 */

import { findAndExecuteCli, getArgs } from './shared/bootstrap-shared.mjs'

async function main() {
  const args = getArgs()
  await findAndExecuteCli(args)
}

// Run the bootstrap.
main().catch((e) => {
  process.stderr.write(`❌ Bootstrap error: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
