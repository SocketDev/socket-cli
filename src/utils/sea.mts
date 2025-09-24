/**
 * SEA (Single Executable Application) detection utilities.
 *
 * Provides reliable detection of whether the current process is running
 * as a Node.js Single Executable Application.
 */

/**
 * Detect if the current process is running as a SEA binary.
 *
 * @returns True if running as SEA, false otherwise
 */
function isSeaBinary(): boolean {
  try {
    // Check for Node.js SEA indicators.
    return !!(
      process.env['NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'] ||
      // Check if running from a single executable.
      (process.argv[0] && !process.argv[0].includes('node'))
    )
  } catch {
    // If any error occurs during detection, assume not SEA.
    return false
  }
}

export { isSeaBinary }
