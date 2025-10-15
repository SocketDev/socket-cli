/**
 * Unified Socket CLI entry point.
 *
 * This single file handles all Socket CLI commands by detecting how it was invoked:
 * - socket (main CLI)
 * - socket-npm (npm wrapper)
 * - socket-npx (npx wrapper)
 * - socket-pnpm (pnpm wrapper)
 * - socket-yarn (yarn wrapper)
 *
 * Perfect for SEA packaging and single-file distribution.
 */

import path from 'node:path'

// Detect how this binary was invoked.
function getInvocationMode(): string {
  // Check environment variable first (for explicit mode).
  const envMode = process.env['SOCKET_CLI_MODE']
  if (envMode) {
    return envMode
  }

  // Check process.argv[1] for the actual script name.
  const scriptPath = process.argv[1]
  if (scriptPath) {
    const scriptName = path
      .basename(scriptPath)
      .replace(/\.(js|mjs|cjs|exe)$/i, '')

    // Map script names to modes.
    if (scriptName.endsWith('-npm') || scriptName === 'npm') {
      return 'npm'
    }
    if (scriptName.endsWith('-npx') || scriptName === 'npx') {
      return 'npx'
    }
    if (scriptName.endsWith('-pnpm') || scriptName === 'pnpm') {
      return 'pnpm'
    }
    if (scriptName.endsWith('-yarn') || scriptName === 'yarn') {
      return 'yarn'
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

  if (argv0.endsWith('npm')) {
    return 'npm'
  }
  if (argv0.endsWith('npx')) {
    return 'npx'
  }
  if (argv0.endsWith('pnpm')) {
    return 'pnpm'
  }
  if (argv0.endsWith('yarn')) {
    return 'yarn'
  }

  // Default to main Socket CLI.
  return 'socket'
}

// Route to the appropriate CLI based on invocation mode.
async function main() {
  const mode = getInvocationMode()

  // Set environment variable for child processes.
  process.env['SOCKET_CLI_MODE'] = mode

  // Import and run the appropriate CLI function.
  switch (mode) {
    case 'npm': {
      const { default: runNpmCli } = await import('./npm-cli.mjs')
      await runNpmCli()
      break
    }

    case 'npx': {
      const { default: runNpxCli } = await import('./npx-cli.mjs')
      await runNpxCli()
      break
    }

    case 'pnpm': {
      const { default: runPnpmCli } = await import('./pnpm-cli.mjs')
      await runPnpmCli()
      break
    }

    case 'yarn': {
      const { default: runYarnCli } = await import('./yarn-cli.mjs')
      await runYarnCli()
      break
    }

    case 'socket':
    default:
      await import('./cli-entry.mjs')
      break
  }
}

// Run the appropriate CLI.
main().catch(error => {
  console.error('Socket CLI Error:', error)
  // eslint-disable-next-line n/no-process-exit -- Required for CLI error handling.
  process.exit(1)
})
