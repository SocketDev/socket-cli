import path from 'node:path'

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

    const scriptMode = getScriptInvocationMode(scriptName)
    if (scriptMode) {
      return scriptMode
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

export function getScriptInvocationMode(
  scriptName: string,
): string | undefined {
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
  return undefined
}
