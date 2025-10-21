/* eslint-disable no-await-in-loop -- Sequential operations required for bootstrap */
/**
 * Ultra-thin bootstrap wrapper for Socket CLI SEA.
 *
 * This bootstrap stub:
 * - Downloads @socketsecurity/cli from npm on first use
 * - Spawns the CLI in a subprocess (system Node.js or embedded runtime)
 * - Handles tarball extraction using inlined nanotar (no system tar dependency)
 * - Supports IPC handshake for self-update mechanism
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import https from 'node:https'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

// @ts-expect-error - nanotar module not available currently
import { parseTarGzip } from 'nanotar'

const require = createRequire(import.meta.url)

// Configurable constants with environment variable overrides.
// os.homedir() can throw if no home directory is available.
let SOCKET_HOME: string
try {
  SOCKET_HOME = process.env['SOCKET_HOME'] || path.join(os.homedir(), '.socket')
} catch (error) {
  console.error(
    'Fatal: Unable to determine home directory. Set SOCKET_HOME environment variable.',
  )
  console.error(`Error: ${formatError(error)}`)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}
const DOWNLOAD_MESSAGE_DELAY_MS = 2_000
const HTTPS_TIMEOUT_MS = 30_000
const IPC_HANDSHAKE_TIMEOUT_MS = 5_000
// 30 seconds total.
const LOCK_MAX_RETRIES = 60
const LOCK_RETRY_DELAY_MS = 500
const NPM_REGISTRY =
  process.env['SOCKET_NPM_REGISTRY'] ||
  process.env['NPM_REGISTRY'] ||
  'https://registry.npmjs.org'
const SOCKET_CLI_DIR =
  process.env['SOCKET_CLI_DIR'] || path.join(SOCKET_HOME, '_cli')
const SOCKET_CLI_PACKAGE =
  process.env['SOCKET_CLI_PACKAGE'] || '@socketsecurity/cli'
const SOCKET_CLI_PACKAGE_JSON = path.join(SOCKET_CLI_DIR, 'package.json')

// ============================================================================
// Helper utilities
// ============================================================================

/**
 * Log message to stderr only in debug mode.
 */
function debugLog(message: string): void {
  if (process.env['DEBUG']) {
    console.error(message)
  }
}

/**
 * Format error object to string message.
 * Handles both Error instances and unknown error types consistently.
 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Sanitize tarball path to prevent directory traversal attacks.
 * Ensures extracted files stay within the target directory.
 */
function sanitizeTarballPath(filePath: string): string {
  // Remove 'package/' prefix from npm tarballs (tarballs always use forward slashes).
  const withoutPrefix = filePath.replace(/^package\//, '')
  // Split path and remove any '..' or '.' segments to prevent traversal.
  const segments = withoutPrefix
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
  // Normalize path separators for the current platform.
  return segments.join(path.sep)
}

/**
 * Remove a file or directory with safety protections.
 * Minimal inline version of @socketsecurity/lib/fs remove().
 * Prevents catastrophic deletes by checking paths are within safe boundaries.
 * @throws {Error} When attempting to delete protected paths.
 */
async function remove(
  filepath: string,
  options?: { force?: boolean },
): Promise<void> {
  const absolutePath = path.resolve(filepath)
  const cwd = process.cwd()

  // Safety check: prevent deleting cwd or parent directories unless forced.
  if (!options?.force) {
    // Check if trying to delete cwd itself.
    if (absolutePath === cwd) {
      throw new Error('Cannot delete the current working directory')
    }

    // Check if trying to delete outside SOCKET_HOME (catastrophic delete protection).
    const relation = path.relative(SOCKET_HOME, absolutePath)
    const isInside = Boolean(
      relation &&
        relation !== '..' &&
        !relation.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relation),
    )

    if (!isInside) {
      throw new Error(
        `Cannot delete files/directories outside SOCKET_HOME (${SOCKET_HOME}). ` +
          `Attempted to delete: ${absolutePath}`,
      )
    }
  }

  // Perform deletion.
  try {
    const stats = await fs.stat(absolutePath)
    if (stats.isDirectory()) {
      await fs.rm(absolutePath, { recursive: true, force: true })
    } else {
      await fs.unlink(absolutePath)
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // Silently ignore if file doesn't exist.
    if (code !== 'ENOENT') {
      throw error
    }
  }
}

// ============================================================================
// Installation lock management
// ============================================================================

/**
 * Acquire an installation lock to prevent concurrent downloads/extractions.
 * Uses a lock file with retries to handle multiple SEA instances starting simultaneously.
 */
async function acquireLock(): Promise<string> {
  const lockPath = path.join(SOCKET_CLI_DIR, '.install.lock')

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
    try {
      // Try to create lock file exclusively (fails if exists).
      // Using 'wx' flag ensures atomic check-and-create operation.
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' })
      debugLog(`Acquired installation lock: ${lockPath}`)
      return lockPath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'EEXIST') {
        // Lock file exists - another process is installing.
        // Check if the lock is stale (process no longer exists).
        try {
          const lockContent = await fs.readFile(lockPath, 'utf8')
          const lockPid = Number.parseInt(lockContent.trim(), 10)
          if (!Number.isNaN(lockPid)) {
            // Try to check if process still exists (Unix-like systems).
            // On Windows this will always succeed, but that's okay - timeout will handle it.
            try {
              process.kill(lockPid, 0)
              // Process exists, wait and retry.
            } catch {
              // Process doesn't exist, remove stale lock.
              await remove(lockPath)
              continue
            }
          }
        } catch {
          // Can't read lock file, assume it's valid.
        }

        if (attempt < LOCK_MAX_RETRIES - 1) {
          debugLog(
            `Installation lock held by another process, waiting... (attempt ${attempt + 1}/${LOCK_MAX_RETRIES})`,
          )
          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
          continue
        }
      }
      throw new Error(
        `Failed to acquire installation lock after ${LOCK_MAX_RETRIES} attempts: ${formatError(error)}`,
      )
    }
  }

  throw new Error(
    'Failed to acquire installation lock: another process is installing CLI',
  )
}

/**
 * Release the installation lock.
 * Silently ignores errors if lock file doesn't exist.
 */
async function releaseLock(lockPath: string): Promise<void> {
  try {
    await remove(lockPath)
    debugLog(`Released installation lock: ${lockPath}`)
  } catch (error) {
    console.error(
      `Warning: Failed to release lock ${lockPath}: ${formatError(error)}`,
    )
  }
}

// ============================================================================
// Download and installation
// ============================================================================

/**
 * Download and extract Socket CLI package from npm registry.
 * Handles locking, download, extraction, and cleanup.
 */
async function downloadAndInstallPackage(version: string): Promise<void> {
  // Delay download message to avoid flashing for fast connections.
  // Typical download times for ~20MB package:
  // - Fast (100+ Mbps): 1-2s → no message
  // - Average (25-50 Mbps): 3-7s → shows message
  // - Slow (5-10 Mbps): 16-33s → shows message
  // Timer is cleared in finally block regardless of success/failure.
  const messageTimer = setTimeout(() => {
    console.error(`Downloading ${SOCKET_CLI_PACKAGE}@${version} from npm...`)
  }, DOWNLOAD_MESSAGE_DELAY_MS)

  let lockPath: string | undefined
  let tarballPath: string | undefined

  try {
    // Ensure CLI directory exists before acquiring lock.
    await fs.mkdir(SOCKET_CLI_DIR, { recursive: true })

    // Acquire installation lock.
    lockPath = await acquireLock()

    // Download tarball to disk.
    tarballPath = await downloadTarball(version)

    // Extract tarball to CLI directory.
    await extractTarball(tarballPath)

    // Remove tarball after successful extraction.
    await remove(tarballPath).catch(error => {
      console.error(
        `Warning: Failed to remove tarball ${tarballPath}: ${formatError(error)}`,
      )
    })
    tarballPath = undefined

    debugLog('Socket CLI downloaded successfully!')
  } finally {
    // Clear timer to prevent message from showing after completion.
    clearTimeout(messageTimer)

    // Clean up tarball if extraction failed.
    if (tarballPath) {
      await remove(tarballPath).catch(() => {
        // Ignore - best effort cleanup.
      })
    }

    // Release installation lock.
    if (lockPath) {
      await releaseLock(lockPath)
    }
  }
}

/**
 * Download tarball from npm registry to disk.
 */
async function downloadTarball(version: string): Promise<string> {
  const tarballUrl = `${NPM_REGISTRY}/${SOCKET_CLI_PACKAGE}/-/cli-${version}.tgz`
  const tarballPath = path.join(SOCKET_CLI_DIR, `cli-${version}.tgz`)

  debugLog(`Downloading tarball from ${tarballUrl}`)

  // Download tarball to buffer.
  let buffer: Buffer
  try {
    buffer = await httpsGet(tarballUrl)
  } catch (error) {
    throw new Error(
      `Failed to download tarball from ${tarballUrl}: ${formatError(error)}`,
    )
  }

  // Write buffer to disk.
  try {
    await retryWithBackoff(() => fs.writeFile(tarballPath, buffer))
  } catch (error) {
    throw new Error(
      `Failed to write tarball to ${tarballPath}: ${formatError(error)}`,
    )
  }

  debugLog(`Downloaded tarball to ${tarballPath} (${buffer.length} bytes)`)
  return tarballPath
}

/**
 * Extract tarball to CLI directory.
 * Validates tarball contents and sanitizes paths to prevent attacks.
 */
async function extractTarball(tarballPath: string): Promise<void> {
  debugLog(`Extracting tarball from ${tarballPath}`)

  // Read tarball from disk.
  let buffer: Buffer
  try {
    buffer = await fs.readFile(tarballPath)
  } catch (error) {
    throw new Error(
      `Failed to read tarball from ${tarballPath}: ${formatError(error)}`,
    )
  }

  // Parse tarball and extract files.
  let files: Awaited<ReturnType<typeof parseTarGzip>>
  try {
    files = await parseTarGzip(buffer)
  } catch (error) {
    throw new Error(`Failed to parse tarball: ${formatError(error)}`)
  }

  // Validate that we got files from the tarball.
  if (!files || files.length === 0) {
    throw new Error(
      'Downloaded tarball is empty or invalid (no files extracted)',
    )
  }

  debugLog(`Extracting ${files.length} files from tarball`)

  for (const file of files) {
    // Sanitize file path to prevent directory traversal attacks.
    // This removes 'package/' prefix, strips '..' segments, and normalizes separators.
    const sanitizedPath = sanitizeTarballPath(file.name)
    const targetPath = path.join(SOCKET_CLI_DIR, sanitizedPath)

    if (file.type === 'directory') {
      await retryWithBackoff(() =>
        fs.mkdir(targetPath, { recursive: true }),
      ).catch(error => {
        throw new Error(
          `Failed to create directory ${targetPath}: ${formatError(error)}`,
        )
      })
    } else if (file.type === 'file' && file.data) {
      // Ensure parent directory exists.
      const parentDir = path.dirname(targetPath)
      await retryWithBackoff(() =>
        fs.mkdir(parentDir, { recursive: true }),
      ).catch(error => {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code === 'ENOSPC') {
          throw new Error(
            `Disk full: Not enough space to extract CLI to ${parentDir}. Free up disk space and try again.`,
          )
        }
        throw new Error(
          `Failed to create parent directory ${parentDir}: ${formatError(error)}`,
        )
      })

      // Write file.
      await retryWithBackoff(() =>
        fs.writeFile(targetPath, file.data as Uint8Array<ArrayBufferLike>),
      ).catch(error => {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code === 'ENOSPC') {
          throw new Error(
            `Disk full: Not enough space to write ${targetPath}. Free up disk space and try again.`,
          )
        }
        throw new Error(
          `Failed to write file ${targetPath}: ${formatError(error)}`,
        )
      })

      // Set file permissions if specified in tarball.
      // npm tarballs preserve Unix file permissions (e.g., executable bits for bin scripts).
      // attrs.mode is an octal string like "0000755" (rwxr-xr-x) or "0000644" (rw-r--r--).
      // We parse it as base-8 (octal) and apply it with fs.chmod.
      // This ensures CLI entry points remain executable after extraction.
      if (file.attrs?.mode) {
        const mode = Number.parseInt(file.attrs.mode, 8)
        // Validate mode is a valid number before attempting chmod.
        if (!Number.isNaN(mode)) {
          await retryWithBackoff(() => fs.chmod(targetPath, mode)).catch(
            error => {
              // chmod failures are non-fatal (e.g., on Windows without proper permissions).
              // Log the error but continue extraction.
              console.error(
                `Warning: Failed to set permissions on ${targetPath}: ${formatError(error)}`,
              )
            },
          )
        }
      }
    }
  }

  debugLog(`Extracted ${files.length} files successfully`)
}

// ============================================================================
// Version management
// ============================================================================

/**
 * Get the installed version of Socket CLI from package.json.
 */
async function getInstalledVersion(): Promise<string | undefined> {
  if (!existsSync(SOCKET_CLI_PACKAGE_JSON)) {
    return undefined
  }
  try {
    const content = await fs.readFile(SOCKET_CLI_PACKAGE_JSON, 'utf8')
    const pkgJson = JSON.parse(content) as { version?: string }
    // Validate version field exists and is non-empty.
    if (pkgJson.version && typeof pkgJson.version === 'string') {
      return pkgJson.version
    }
  } catch {}
  return undefined
}

/**
 * Fetch the latest version of Socket CLI from npm registry.
 */
async function getLatestVersion(): Promise<string> {
  try {
    const buffer = await httpsGet(
      `${NPM_REGISTRY}/${SOCKET_CLI_PACKAGE}/latest`,
    )
    const data = JSON.parse(buffer.toString()) as { version?: string }
    // Validate version field exists and is non-empty.
    if (!data.version || typeof data.version !== 'string') {
      throw new Error('npm registry response missing or invalid version field')
    }
    return data.version
  } catch (error) {
    throw new Error(
      `Failed to fetch latest version from ${NPM_REGISTRY}: ${formatError(error)}`,
    )
  }
}

/**
 * Get system Node.js version if available and meets minimum version requirement.
 */
async function getSystemNodeVersion(
  minNodeVersion: number,
): Promise<string | undefined> {
  try {
    const testChild = spawn('node', ['--version'], { stdio: 'pipe' })
    let versionOutput = ''

    testChild.stdout?.on('data', data => {
      versionOutput += data.toString()
    })

    await new Promise<void>((resolve, reject) => {
      testChild.on('error', reject)
      testChild.on('exit', code => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`node --version exited with code ${code}`))
        }
      })
    })

    // Parse version (e.g., "v22.1.0" -> 22).
    const match = versionOutput.trim().match(/(?<=^v)\d+/)
    if (match) {
      const majorVersion = Number.parseInt(match[0], 10)
      const systemNodeVersion = versionOutput.trim()

      if (majorVersion >= minNodeVersion) {
        console.error(
          `Using system Node.js ${systemNodeVersion} to run Socket CLI`,
        )
        return systemNodeVersion
      }
      console.error(
        `System Node.js ${systemNodeVersion} is too old (need >=v${minNodeVersion})`,
      )
      console.error('Falling back to embedded Node.js runtime')
    }
  } catch {
    console.error('System Node.js not found, using embedded runtime')
  }

  return undefined
}

// ============================================================================
// Network operations
// ============================================================================

/**
 * Make an HTTPS GET request and return the response as a Buffer.
 * Handles 301/302 redirects automatically with timeout.
 */
async function httpsGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https
      .get(url, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            return httpsGet(res.headers.location).then(resolve, reject)
          }
          reject(
            new Error(
              `HTTP ${res.statusCode} redirect missing Location header`,
            ),
          )
          return
        }

        if (res.statusCode !== 200) {
          reject(
            new Error(
              `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}`,
            ),
          )
          return
        }

        // Capture content-length header for validation if present.
        const contentLength = res.headers['content-length']
          ? Number.parseInt(res.headers['content-length'], 10)
          : undefined

        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          // Validate content-length if provided to detect truncated downloads.
          // This catches cases where network drops mid-download.
          if (contentLength !== undefined && buffer.length !== contentLength) {
            reject(
              new Error(
                `Download incomplete: received ${buffer.length} bytes but expected ${contentLength} bytes. Network may have been interrupted.`,
              ),
            )
            return
          }
          resolve(buffer)
        })
        res.on('error', reject)
      })
      .on('error', reject)
      .on('timeout', () => {
        request.destroy()
        reject(
          new Error(
            `Request timeout after ${HTTPS_TIMEOUT_MS}ms while fetching ${url}`,
          ),
        )
      })

    request.setTimeout(HTTPS_TIMEOUT_MS)
  })
}

/**
 * Retry a function with exponential backoff.
 * Useful for transient filesystem errors (e.g., EBUSY on Windows).
 * Note: Aligns with socket-registry's pRetry defaults.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 200,
  backoffFactor = 2,
): Promise<T> {
  let lastError: Error | unknown
  let delay = baseDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      // Only retry on transient errors (EBUSY, EMFILE, ENFILE).
      const code = (error as NodeJS.ErrnoException)?.code
      if (
        attempt < maxRetries &&
        (code === 'EBUSY' || code === 'EMFILE' || code === 'ENFILE')
      ) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= backoffFactor
        continue
      }
      throw error
    }
  }
  throw lastError
}

// ============================================================================
// Process spawning
// ============================================================================

/**
 * Spawn embedded Node.js to run the Socket CLI with IPC channel.
 * Uses the current executable (SEA) to run CLI in subprocess.
 */
async function spawnEmbeddedNode(
  cliPath: string,
  args: string[] | readonly string[],
): Promise<void> {
  return spawnNodeProcess(process.execPath, args, {
    env: process.env,
    cliPathForEmbedded: cliPath,
  })
}

/**
 * Common helper to spawn a Node.js process to run the Socket CLI.
 * Handles IPC handshake and waits for process exit.
 */
async function spawnNodeProcess(
  command: string,
  commandArgs: string[] | readonly string[],
  options: {
    env: NodeJS.ProcessEnv
    cliPathForEmbedded?: string
  },
): Promise<void> {
  const { cliPathForEmbedded, env } = options

  const child = spawn(command, commandArgs, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env,
  })

  // Send stub location via IPC using handshake protocol.
  child.on('spawn', () => {
    const stubPath = process.argv[0]
    const handshake: {
      SOCKET_IPC_HANDSHAKE: {
        SOCKET_CLI_STUB_PATH?: string
        SOCKET_CLI_PATH?: string
      }
    } = {
      SOCKET_IPC_HANDSHAKE: {},
    }

    if (stubPath) {
      handshake.SOCKET_IPC_HANDSHAKE.SOCKET_CLI_STUB_PATH = stubPath
    }
    if (cliPathForEmbedded) {
      handshake.SOCKET_IPC_HANDSHAKE.SOCKET_CLI_PATH = cliPathForEmbedded
    }

    if (Object.keys(handshake.SOCKET_IPC_HANDSHAKE).length > 0) {
      try {
        child.send?.(handshake)
      } catch (error) {
        console.error(
          `Warning: Failed to send IPC handshake: ${formatError(error)}`,
        )
      }
    }
  })

  // Wait for child process to exit.
  return new Promise<void>((_resolve, reject) => {
    child.on('error', error => {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        reject(
          new Error(
            `Command not found: ${command}. Ensure Node.js is installed and in PATH.`,
          ),
        )
      } else {
        reject(new Error(`Failed to spawn ${command}: ${formatError(error)}`))
      }
    })
    child.on('exit', code => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code ?? 0)
    })
  })
}

/**
 * Spawn system Node.js to run the Socket CLI with IPC channel.
 * Sends stub path via IPC for self-update mechanism.
 */
async function spawnSystemNode(
  cliPath: string,
  args: string[] | readonly string[],
): Promise<void> {
  return spawnNodeProcess('node', [cliPath, ...args], {
    env: process.env,
  })
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Main entry point for bootstrap stub.
 * Ensures CLI is installed, then spawns it with system Node.js.
 */
async function main(): Promise<void> {
  // Check if we're being spawned to execute the CLI directly (bypass bootstrap).
  // Parent sends CLI path via IPC handshake.
  if (process.send) {
    const cliPath = await new Promise<string | undefined>(resolve => {
      const timeout = setTimeout(
        () => resolve(undefined),
        IPC_HANDSHAKE_TIMEOUT_MS,
      )
      process.on('message', msg => {
        if (
          msg !== null &&
          typeof msg === 'object' &&
          'SOCKET_IPC_HANDSHAKE' in msg &&
          msg.SOCKET_IPC_HANDSHAKE !== null &&
          typeof msg.SOCKET_IPC_HANDSHAKE === 'object' &&
          msg.SOCKET_IPC_HANDSHAKE &&
          'SOCKET_CLI_PATH' in msg.SOCKET_IPC_HANDSHAKE
        ) {
          clearTimeout(timeout)
          resolve(msg.SOCKET_IPC_HANDSHAKE.SOCKET_CLI_PATH as string)
        }
      })
    })

    if (cliPath) {
      // Verify CLI file exists before attempting to require it.
      if (!existsSync(cliPath)) {
        console.error(
          `Fatal: CLI entry point not found at ${cliPath}. Installation may be corrupted.`,
        )
        // eslint-disable-next-line n/no-process-exit
        process.exit(1)
      }

      // Set process.argv to include CLI path and user arguments.
      const execPath = process.argv[0]
      if (!execPath) {
        throw new Error('process.argv[0] is unexpectedly undefined')
      }
      process.argv = [execPath, cliPath, ...process.argv.slice(1)]
      // Load and execute the CLI with embedded Node.js.
      try {
        require(cliPath)
      } catch (error) {
        console.error(
          `Fatal: Failed to load CLI from ${cliPath}: ${formatError(error)}`,
        )
        // eslint-disable-next-line n/no-process-exit
        process.exit(1)
      }
      return
    }
  }

  try {
    // Ensure Socket home directory exists with better error messages.
    try {
      await fs.mkdir(SOCKET_HOME, { recursive: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Permission denied creating ${SOCKET_HOME}. Try running with appropriate permissions or set SOCKET_HOME to a writable directory.`,
        )
      }
      throw new Error(
        `Failed to create Socket home directory ${SOCKET_HOME}: ${formatError(error)}`,
      )
    }

    const installedVersion = await getInstalledVersion()

    if (!installedVersion) {
      console.error('Downloading Socket CLI from npm...')
      try {
        const latestVersion = await getLatestVersion()
        await downloadAndInstallPackage(latestVersion)
      } catch (error) {
        throw new Error(`Failed to download Socket CLI: ${formatError(error)}`)
      }
    }

    // Find CLI entry point.
    const cliPath = path.join(SOCKET_CLI_DIR, 'dist', 'cli.js')

    // Verify CLI entry point exists after installation.
    if (!existsSync(cliPath)) {
      throw new Error(
        `CLI entry point not found at ${cliPath}. Installation may have failed or package structure changed.`,
      )
    }

    // Forward all arguments to the CLI.
    const args = process.argv.slice(2)

    // process.env.MIN_NODE_VERSION is inlined at build time.
    const minNodeVersion = Number.parseInt(
      process.env['MIN_NODE_VERSION'] ?? '0',
      10,
    )

    const systemNodeVersion = await getSystemNodeVersion(minNodeVersion)

    if (systemNodeVersion) {
      debugLog('Using system Node.js to run Socket CLI')
      await spawnSystemNode(cliPath, args)
    } else {
      debugLog('Using embedded Node.js to run Socket CLI')
      await spawnEmbeddedNode(cliPath, args)
    }
  } catch (error) {
    console.error('Socket CLI bootstrap error:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
})
