import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getInvocationMode } from './util/cli/invocation-mode.mts'

const logger = getDefaultLogger()

// Route to the appropriate CLI based on invocation mode.
async function main() {
  const mode = getInvocationMode()

  // Set environment variable for child processes.
  process.env['SOCKET_CLI_MODE'] = mode

  // Import and run the appropriate CLI function.
  // All wrapper modes now route through the main CLI entry with the mode set.
  // The CLI will detect the mode and run the appropriate command.
  await import('./cli-entry.mjs')
}

// Run the appropriate CLI.
main().catch(error => {
  logger.error('Socket CLI Error:', error)
  process.exit(1)
})
