import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// Detect how this binary was invoked.
export function getInvocationMode(): string {
  // Check environment variable first, for explicit mode.
  const envMode = process.env['SOCKET_CLI_MODE']
  if (envMode) {
    return envMode
  }

  // Check process.argv[1] for the actual script name.
  const scriptPath = process.argv[1]
  if (scriptPath) {
    const scriptName = path
      .basename(scriptPath)
      .replace(/\.(cjs|exe|js|mjs)$/i, '')

    const wrapperMode = invocationWrapperMode(scriptName)
    if (wrapperMode) {
      return wrapperMode
    }
    // For 'cli' or anything containing 'socket', default to socket mode.
    if (scriptName.includes('socket') || scriptName === 'cli') {
      return 'socket'
    }
  }

  // Check process.argv0 as fallback.
  const argv0 = path
    .basename(process.argv0 || process.execPath)
    .replace(/\.exe$/i, '')

  for (const mode of ['pnpm', 'npm', 'npx', 'yarn']) {
    if (argv0.endsWith(mode)) {
      return mode
    }
  }

  // Default to main Socket CLI.
  return 'socket'
}

export function invocationWrapperMode(name: string): string | undefined {
  return ['pnpm', 'npm', 'npx', 'yarn'].find(
    mode => name.endsWith(`-${mode}`) || name === mode,
  )
}

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
