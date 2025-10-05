/**
 * Ultra-thin bootstrap wrapper for Socket CLI SEA.
 *
 * This is the THINNEST possible wrapper that:
 * - Downloads @socketsecurity/cli from npm on first use
 * - Executes it with user's arguments
 * - Has NO external dependencies except Node.js built-ins
 */

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Simple path normalization helper for Windows compatibility.
function normalizePath(filepath: string): string {
  return filepath.split(path.sep).join('/')
}

// Simplified inline form of remove() from @socketsecurity/registry/lib/fs
// to satisfy the no external deps policy for this file.
// Includes safety checks from the 'del' package to prevent deleting cwd and above.
async function remove(
  filepath: string,
  options?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  const absolutePath = path.resolve(filepath)

  // Safety checks (can be bypassed with force flag for controlled operations).
  if (!options?.force) {
    // isPathCwd: prevent deleting current working directory.
    if (!path.relative(absolutePath, process.cwd())) {
      throw new Error(
        'Cannot delete the current working directory. Can be overridden with the force option.',
      )
    }

    // isPathInside: verify path is inside cwd.
    const cwd = process.cwd()
    const relation = path.relative(cwd, absolutePath)
    const isInside = Boolean(
      relation &&
        relation !== '..' &&
        !relation.startsWith(`..${path.sep}`) &&
        relation !== path.resolve(absolutePath),
    )
    if (!isInside) {
      throw new Error(
        'Cannot delete files/directories outside the current working directory. Can be overridden with the force option.',
      )
    }
  }

  await fs.rm(absolutePath, options)
}

// Configurable constants with environment variable overrides.
const SOCKET_HOME = normalizePath(
  process.env['SOCKET_HOME'] || path.join(os.homedir(), '.socket'),
)
const SOCKET_CLI_DIR = normalizePath(
  process.env['SOCKET_CLI_DIR'] || path.join(SOCKET_HOME, 'cli'),
)
const SOCKET_CLI_PACKAGE =
  process.env['SOCKET_CLI_PACKAGE'] || '@socketsecurity/cli'
const NPM_REGISTRY =
  process.env['SOCKET_NPM_REGISTRY'] ||
  process.env['NPM_REGISTRY'] ||
  'https://registry.npmjs.org'

async function getLatestVersion(): Promise<string> {
  const response = await fetch(`${NPM_REGISTRY}/${SOCKET_CLI_PACKAGE}/latest`)
  if (!response.ok) {
    throw new Error(`Failed to fetch package info: ${response.statusText}`)
  }
  const data = (await response.json()) as { version: string }
  return data.version
}

async function downloadPackage(version: string): Promise<void> {
  console.error(`Downloading ${SOCKET_CLI_PACKAGE}@${version} from npm...`)

  const tarballUrl = `${NPM_REGISTRY}/${SOCKET_CLI_PACKAGE}/-/cli-${version}.tgz`
  const response = await fetch(tarballUrl)

  if (!response.ok) {
    throw new Error(`Failed to download package: ${response.statusText}`)
  }

  const tempDir = normalizePath(
    path.join(
      SOCKET_HOME,
      'tmp',
      crypto.createHash('sha256').update(`${version}`).digest('hex'),
    ),
  )
  await fs.mkdir(tempDir, { recursive: true })

  try {
    const tarballPath = normalizePath(path.join(tempDir, 'package.tgz'))
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(tarballPath, buffer)

    // Extract tarball using tar command.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xzf', tarballPath, '-C', tempDir], {
        stdio: 'ignore',
      })
      child.on('exit', code =>
        code === 0 ? resolve() : reject(new Error('tar failed')),
      )
    })

    const packageDir = normalizePath(path.join(tempDir, 'package'))

    if (existsSync(SOCKET_CLI_DIR)) {
      await remove(SOCKET_CLI_DIR, { recursive: true, force: true })
    }

    await fs.rename(packageDir, SOCKET_CLI_DIR)

    // Install dependencies.
    console.error('Installing dependencies...')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'npm',
        ['install', '--production', '--no-save', '--no-audit', '--no-fund'],
        {
          cwd: SOCKET_CLI_DIR,
          stdio: 'inherit',
        },
      )
      child.on('exit', code =>
        code === 0 ? resolve() : reject(new Error('npm install failed')),
      )
    })

    console.error('Socket CLI downloaded successfully!')
  } finally {
    await remove(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function getInstalledVersion(): Promise<string | null> {
  const packageJsonPath = normalizePath(
    path.join(SOCKET_CLI_DIR, 'package.json'),
  )

  if (!existsSync(packageJsonPath)) {
    return null
  }

  try {
    const content = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(content) as { version: string }
    return packageJson.version
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  try {
    await fs.mkdir(SOCKET_HOME, { recursive: true })

    const installedVersion = await getInstalledVersion()

    if (!installedVersion) {
      console.error('First run detected. Downloading Socket CLI from npm...')
      const latestVersion = await getLatestVersion()
      await downloadPackage(latestVersion)
    }

    // Find CLI entry point.
    const packageJsonPath = normalizePath(
      path.join(SOCKET_CLI_DIR, 'package.json'),
    )
    const content = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(content) as {
      bin?: Record<string, string> | string
    }

    let cliPath: string
    if (typeof packageJson.bin === 'string') {
      cliPath = normalizePath(path.join(SOCKET_CLI_DIR, packageJson.bin))
    } else if (packageJson.bin?.['socket']) {
      cliPath = normalizePath(
        path.join(SOCKET_CLI_DIR, packageJson.bin['socket']),
      )
    } else {
      cliPath = normalizePath(path.join(SOCKET_CLI_DIR, 'dist', 'cli.js'))
    }

    // Forward all arguments to the CLI.
    const args = process.argv.slice(2)

    // The SEA contains Node.js runtime, so we need to find a way to execute
    // the downloaded CLI. Since require() won't work in SEA context for external
    // modules, we need to spawn using system Node.js if available.

    // Try using 'node' from PATH first.
    const nodeCmd = 'node'
    let useSystemNode = true

    // Quick check if node exists.
    try {
      const testChild = spawn('node', ['--version'], { stdio: 'pipe' })
      await new Promise<void>(resolve => {
        testChild.on('error', () => {
          useSystemNode = false
          resolve()
        })
        testChild.on('exit', code => {
          if (code !== 0) {
            useSystemNode = false
          }
          resolve()
        })
      })
    } catch {
      useSystemNode = false
    }

    if (!useSystemNode) {
      console.error('Error: Node.js is required to run Socket CLI')
      console.error(
        'The SEA wrapper has downloaded the CLI but needs Node.js to execute it.',
      )
      console.error('Please install Node.js from https://nodejs.org/')
      // eslint-disable-next-line n/no-process-exit
      process.exit(1)
    }

    // Spawn with system Node.js.
    const child = spawn(nodeCmd, [cliPath, ...args], {
      stdio: 'inherit',
      env: process.env,
    })

    child.on('exit', code => {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code || 0)
    })
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
