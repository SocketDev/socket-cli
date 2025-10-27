/**
 * Node.js flags for bootstrap (minimal implementation for size).
 * This file is bundled into bootstrap, not imported at runtime.
 */

/**
 * Get Node major version number.
 */
function getNodeMajorVersion(): number {
  return Number.parseInt(process.version.slice(1).split('.')[0] || '0', 10)
}

/**
 * Get Node minor version number.
 */
function getNodeMinorVersion(): number {
  return Number.parseInt(process.version.split('.')[1] || '0', 10)
}

/**
 * Check if --disable-sigusr1 flag is supported.
 * Supported in v22.14.0+, v23.7.0+, v24.8.0+ (stable in v22.20.0+, v24.8.0+).
 */
function supportsDisableSigusr1(): boolean {
  const major = getNodeMajorVersion()
  const minor = getNodeMinorVersion()

  if (major >= 24) {
    return minor >= 8
  }
  if (major === 23) {
    return minor >= 7
  }
  if (major === 22) {
    return minor >= 14
  }
  return false
}

/**
 * Get flags to disable SIGUSR1 debugger signal handling.
 * Returns --disable-sigusr1 for newer Node, --no-inspect for older versions.
 */
export function getNodeDisableSigusr1Flags(): string[] {
  return supportsDisableSigusr1() ? ['--disable-sigusr1'] : ['--no-inspect']
}
