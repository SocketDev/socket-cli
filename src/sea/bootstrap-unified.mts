/**
 * Unified bootstrap wrapper for Socket CLI SEA with multi-command support.
 *
 * This bootstrap detects the invoked binary name and routes to the appropriate
 * Socket CLI command. Supports:
 * - socket (main CLI)
 * - socket-npm (npm wrapper)
 * - socket-npx (npx wrapper)
 * - socket-pnpm (pnpm wrapper)
 * - socket-yarn (yarn wrapper)
 *
 * The binary can be invoked directly or through symlinks.
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { parseTarGzip } from 'nanotar'

// ============================================================================
// Configuration
// ============================================================================

// Detect how this binary was invoked
const INVOKED_AS =
  path.basename(process.argv0) || path.basename(process.execPath)
const BINARY_NAME = INVOKED_AS.replace(/\.exe$/i, '') // Remove .exe on Windows

// Map binary names to their CLI entry points
const COMMAND_MAP = {
  socket: 'cli.js',
  'socket-npm': 'npm-cli.js',
  'socket-npx': 'npx-cli.js',
  'socket-pnpm': 'pnpm-cli.js',
  'socket-yarn': 'yarn-cli.js',
} as const

// Determine which command to run
function getTargetCommand(): string {
  // Check exact match first
  if (COMMAND_MAP[BINARY_NAME as keyof typeof COMMAND_MAP]) {
    return COMMAND_MAP[BINARY_NAME as keyof typeof COMMAND_MAP]
  }

  // Check if binary name ends with any of our commands (handles cases like /usr/local/bin/socket-npm)
  for (const [cmdName, entryPoint] of Object.entries(COMMAND_MAP)) {
    if (BINARY_NAME.endsWith(cmdName)) {
      return entryPoint
    }
  }

  // Default to main CLI
  console.warn(`Unknown command '${BINARY_NAME}', defaulting to 'socket'`)
  return 'cli.js'
}

// Configurable constants with environment variable overrides
let SOCKET_HOME: string
try {
  SOCKET_HOME = process.env['SOCKET_HOME'] || path.join(os.homedir(), '.socket')
} catch (error) {
  console.error(
    'Fatal: Unable to determine home directory. Set SOCKET_HOME environment variable.',
  )
  console.error(`Error: ${formatError(error)}`)
  process.exit(1)
}

const DOWNLOAD_MESSAGE_DELAY_MS = 2_000
const HTTPS_TIMEOUT_MS = 30_000
const IPC_HANDSHAKE_TIMEOUT_MS = 5_000
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }
  return String(error)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Simple file locking mechanism using lock files.
 */
async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const lockDir = path.dirname(lockPath)
  await fs.mkdir(lockDir, { recursive: true })

  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      // Try to create lock file exclusively
      const fd = await fs.open(lockPath, 'wx')
      await fd.write(`${process.pid}\n`)
      await fd.close()

      // Return unlock function
      return async () => {
        try {
          await fs.unlink(lockPath)
        } catch {
          // Ignore unlock errors
        }
      }
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Lock exists, check if process is still alive
        try {
          const pidStr = await fs.readFile(lockPath, 'utf-8')
          const pid = parseInt(pidStr.trim(), 10)

          // Check if process exists
          try {
            process.kill(pid, 0)
            // Process exists, wait and retry
          } catch {
            // Process doesn't exist, remove stale lock
            await fs.unlink(lockPath).catch(() => {})
            continue
          }
        } catch {
          // Can't read lock file, try to remove it
          await fs.unlink(lockPath).catch(() => {})
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
      } else {
        throw error
      }
    }
  }

  throw new Error(`Failed to acquire lock after ${LOCK_MAX_RETRIES} attempts`)
}

/**
 * Download a package from npm registry.
 */
async function downloadPackage(
  packageName: string,
  version: string = 'latest',
): Promise<Buffer> {
  // Get package metadata
  const metadataUrl = `${NPM_REGISTRY}/${packageName}`
  const metadata = await fetchJson(metadataUrl)

  // Resolve version
  const resolvedVersion =
    version === 'latest' ? metadata['dist-tags']?.latest : version

  if (!resolvedVersion) {
    throw new Error(`Version '${version}' not found for package ${packageName}`)
  }

  // Get tarball URL
  const versionData = metadata.versions?.[resolvedVersion]
  if (!versionData) {
    throw new Error(
      `Version data not found for ${packageName}@${resolvedVersion}`,
    )
  }

  const tarballUrl = versionData.dist?.tarball
  if (!tarballUrl) {
    throw new Error(
      `Tarball URL not found for ${packageName}@${resolvedVersion}`,
    )
  }

  // Download tarball
  console.log(`Downloading ${packageName}@${resolvedVersion}...`)
  return fetchBuffer(tarballUrl)
}

/**
 * Fetch JSON from a URL.
 */
async function fetchJson(url: string): Promise<any> {
  const buffer = await fetchBuffer(url)
  return JSON.parse(buffer.toString('utf-8'))
}

/**
 * Fetch buffer from a URL.
 */
function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: HTTPS_TIMEOUT_MS }, response => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        const location = response.headers.location
        if (!location) {
          reject(new Error('Redirect without location header'))
          return
        }
        fetchBuffer(location).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(
          new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
        )
        return
      }

      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })

    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

/**
 * Extract package from tarball.
 */
async function extractPackage(
  tarballBuffer: Buffer,
  targetDir: string,
): Promise<void> {
  const files = parseTarGzip(tarballBuffer)

  // Create target directory
  await fs.mkdir(targetDir, { recursive: true })

  // Extract files (they're typically under 'package/' prefix)
  for (const file of files) {
    if (file.type !== 'file') {
      continue
    }

    // Remove 'package/' prefix
    const relativePath = file.name.replace(/^package\//, '')
    const targetPath = path.join(targetDir, relativePath)

    // Create directory
    await fs.mkdir(path.dirname(targetPath), { recursive: true })

    // Write file
    await fs.writeFile(targetPath, file.data, {
      mode: file.mode || 0o644,
    })
  }
}

/**
 * Ensure Socket CLI is installed.
 */
async function ensureSocketCli(): Promise<string> {
  // Check if already installed
  if (await fileExists(SOCKET_CLI_PACKAGE_JSON)) {
    try {
      const pkgJson = JSON.parse(
        await fs.readFile(SOCKET_CLI_PACKAGE_JSON, 'utf-8'),
      )

      // Return the bin directory path
      const binDir = path.join(SOCKET_CLI_DIR, 'bin')
      if (await fileExists(binDir)) {
        return binDir
      }
    } catch {
      // Invalid installation, re-download
    }
  }

  // Acquire lock for download
  const lockPath = path.join(SOCKET_HOME, '.download.lock')
  const unlock = await acquireLock(lockPath)

  try {
    // Double-check after acquiring lock
    if (await fileExists(SOCKET_CLI_PACKAGE_JSON)) {
      const binDir = path.join(SOCKET_CLI_DIR, 'bin')
      if (await fileExists(binDir)) {
        return binDir
      }
    }

    // Show download message after delay
    const downloadTimer = setTimeout(() => {
      console.log(`Initializing Socket CLI (first run only)...`)
    }, DOWNLOAD_MESSAGE_DELAY_MS)

    try {
      // Download and extract
      const tarball = await downloadPackage(SOCKET_CLI_PACKAGE)

      // Clear any existing installation
      await fs.rm(SOCKET_CLI_DIR, { recursive: true, force: true })

      // Extract to CLI directory
      await extractPackage(tarball, SOCKET_CLI_DIR)

      clearTimeout(downloadTimer)

      return path.join(SOCKET_CLI_DIR, 'bin')
    } catch (error) {
      clearTimeout(downloadTimer)
      throw error
    }
  } finally {
    await unlock()
  }
}

// ============================================================================
// Main execution
// ============================================================================

async function main() {
  try {
    // Ensure Socket CLI is installed
    const binDir = await ensureSocketCli()

    // Determine which command to run
    const targetCommand = getTargetCommand()
    const targetPath = path.join(binDir, targetCommand)

    // Check if target exists
    if (!(await fileExists(targetPath))) {
      console.error(`Error: Command entry point not found: ${targetPath}`)
      console.error(`This may indicate an incomplete Socket CLI installation.`)
      process.exit(1)
    }

    // Spawn the target command
    const child = spawn(
      process.execPath,
      [targetPath, ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          // Pass through that we're running from SEA
          SOCKET_SEA_BOOTSTRAP: '1',
          SOCKET_INVOKED_AS: BINARY_NAME,
        },
      },
    )

    // Forward signals
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
    for (const signal of signals) {
      process.on(signal, () => {
        child.kill(signal)
      })
    }

    // Wait for child to exit
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
      } else {
        process.exit(code ?? 1)
      }
    })
  } catch (error) {
    console.error('Bootstrap failed:', formatError(error))
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}
