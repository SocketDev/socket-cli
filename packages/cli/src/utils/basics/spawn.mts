/**
 * Socket-basics spawning utilities for comprehensive security scanning.
 *
 * Spawns socket-basics (Python orchestration tool) with extracted security tools
 * to perform SAST, secret detection, and container scanning.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { debug } from '@socketsecurity/lib/debug'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  areSecurityToolsAvailable,
  extractSecurityTools,
  getToolPaths,
} from './vfs-extract.mts'
import { DOT_SOCKET_DOT_FACTS_JSON } from '../../constants.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'

import type { CResult } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'

export type SocketBasicsOptions = {
  cacheDir?: string
  cwd: string
  languages?: string[]
  orgSlug: string
  outputPath?: string
  repoName: string
  scanContainers?: boolean
  scanSecrets?: boolean
  spinner?: Spinner
  timeout?: number
}

export type SocketBasicsResult = {
  factsPath: string | null
  findings: {
    containers?: number
    sast?: number
    secrets?: number
  }
}

/**
 * Run socket-basics comprehensive security scanning.
 *
 * Spawns socket-basics (Python tool) to perform:
 * - SAST (Static Application Security Testing) via OpenGrep
 * - Secret detection via TruffleHog
 * - Container scanning via Trivy (if images are specified)
 *
 * Environment Variables Set:
 * - SKIP_SOCKET_REACH=1 - Skip reachability analysis (handled separately by CLI)
 * - SKIP_SOCKET_SUBMISSION=1 - Skip socket-basics submitting to Socket API
 * - PATH - Updated to include extracted tool directories
 *
 * @param options - Socket-basics configuration options.
 * @returns Result with path to .socket.facts.json and finding counts.
 *
 * @example
 * const result = await runSocketBasics({
 *   cwd: '/path/to/project',
 *   orgSlug: 'my-org',
 *   repoName: 'my-repo',
 *   languages: ['python', 'javascript'],
 *   scanSecrets: true,
 * })
 *
 * if (result.ok && result.data.factsPath) {
 *   logger.log('Socket facts:', result.data.factsPath)
 *   logger.log('SAST findings:', result.data.findings.sast)
 *   logger.log('Secrets found:', result.data.findings.secrets)
 * }
 */
export async function runSocketBasics(
  options: SocketBasicsOptions,
): Promise<CResult<SocketBasicsResult>> {
  const {
    cacheDir,
    cwd,
    languages = [],
    orgSlug,
    outputPath,
    repoName,
    scanContainers = false,
    scanSecrets = true,
    spinner,
    timeout = 600_000, // 10 minutes default.
  } = options

  // Check if security tools are available.
  const toolsAvailable = areSecurityToolsAvailable()
  if (!toolsAvailable) {
    return {
      ok: false,
      message: 'Security tools not available',
      cause:
        'Socket-basics requires Python, Trivy, TruffleHog, and OpenGrep to be bundled in the SEA binary',
    }
  }

  // Extract security tools from VFS.
  // Pass cacheDir to isolate parallel builds.
  spinner?.start('Extracting security tools...')
  const toolsDir = await extractSecurityTools(cacheDir)
  if (!toolsDir) {
    spinner?.fail('Failed to extract security tools')
    return {
      ok: false,
      message: 'Failed to extract security tools from VFS',
      cause: 'VFS extraction returned null',
    }
  }

  const toolPaths = getToolPaths(toolsDir)

  // Verify Python is available.
  if (!existsSync(toolPaths.python)) {
    spinner?.fail('Python not found after extraction')
    return {
      ok: false,
      message: 'Python not found',
      cause: `Expected Python at: ${toolPaths.python}`,
    }
  }

  if (spinner) {
    spinner.stop()
    spinner.success('Security tools extracted')
  }

  // Determine output path for .socket.facts.json.
  const factsPath =
    outputPath || normalizePath(path.join(cwd, DOT_SOCKET_DOT_FACTS_JSON))

  // Install socketsecurity package via pip if not already installed.
  spinner?.start('Installing Socket Python CLI...')
  const pyCliVersion = getPyCliVersion()
  const pipInstallResult = await spawn(
    toolPaths.python,
    ['-m', 'pip', 'install', '--quiet', `socketsecurity==${pyCliVersion}`],
    { stdio: 'pipe' },
  )

  // Check spawn result - it can be null if process failed to start.
  if (!pipInstallResult) {
    if (spinner) {
      spinner.stop()
      spinner.fail('Failed to start pip install')
    }
    return {
      ok: false,
      message: 'Failed to start pip install process',
      cause: 'spawn() returned null',
    }
  }

  if (pipInstallResult.code !== 0) {
    if (spinner) {
      spinner.stop()
      spinner.fail('Failed to install Socket Python CLI')
    }
    debug('error', 'pip install failed:', pipInstallResult.stderr)
    return {
      ok: false,
      message: 'Failed to install Socket Python CLI',
      cause: String(
        pipInstallResult.stderr || 'pip install exited with non-zero code',
      ),
    }
  }

  if (spinner) {
    spinner.stop()
    spinner.success('Socket Python CLI installed')
  }

  // Verify installed version matches expected version.
  const verifyResult = await spawn(
    toolPaths.python,
    ['-m', 'pip', 'show', 'socketsecurity'],
    { stdio: 'pipe' },
  )

  if (!verifyResult || verifyResult.code !== 0) {
    if (spinner) {
      spinner.stop()
      spinner.fail('Failed to verify Socket Python CLI installation')
    }
    return {
      ok: false,
      message: 'Failed to verify Socket Python CLI installation',
      cause: String(
        verifyResult?.stderr || 'pip show exited with non-zero code',
      ),
    }
  }

  const output = String(verifyResult.stdout || '')
  const versionMatch = output.match(/^Version:\s*(.+)$/m)
  const installedVersion = versionMatch?.[1]?.trim()

  if (installedVersion !== pyCliVersion) {
    if (spinner) {
      spinner.stop()
      spinner.fail(
        `Socket Python CLI version mismatch: expected ${pyCliVersion}, got ${installedVersion}`,
      )
    }
    return {
      ok: false,
      message: 'Socket Python CLI version mismatch',
      cause: `Expected version ${pyCliVersion} but got ${installedVersion}. This may cause compatibility issues.`,
    }
  }

  debug('notice', `Socket Python CLI version verified: ${installedVersion}`)

  // Construct socket-basics command.
  // socket-basics is a module within the socketsecurity package.
  const args = [
    '-m',
    'socketsecurity.basics',
    '--org',
    orgSlug,
    '--repo',
    repoName,
    '--output',
    factsPath,
  ]

  // Add language filters if specified.
  if (languages.length > 0) {
    args.push('--languages', languages.join(','))
  }

  // Enable/disable scanning features.
  if (scanSecrets) {
    args.push('--secrets')
  }

  if (scanContainers) {
    args.push('--containers')
  }

  // Set up environment variables.
  const env = {
    ...process.env,
    // Skip reachability analysis (handled by CLI's --reach flag).
    SKIP_SOCKET_REACH: '1',
    // Skip socket-basics submitting to Socket API (CLI handles unified submission).
    SKIP_SOCKET_SUBMISSION: '1',
    // Set PATH to only include extracted tool directories (security: don't append user's PATH).
    // The extracted tools are self-contained and don't need system PATH.
    PATH: `${path.dirname(toolPaths.python)}:${toolsDir}`,
  }

  // Run socket-basics.
  spinner?.start('Running comprehensive security scan...')
  debug(
    'notice',
    `Running socket-basics: ${toolPaths.python} ${args.join(' ')}`,
  )

  const startTime = Date.now()
  const basicsResult = await spawn(toolPaths.python, args, {
    cwd,
    env,
    stdio: 'pipe',
    timeout,
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  // Check spawn result - it can be null if process failed to start.
  if (!basicsResult) {
    if (spinner) {
      spinner.stop()
      spinner.fail('Failed to start socket-basics process')
    }
    return {
      ok: false,
      message: 'Failed to start socket-basics process',
      cause: 'spawn() returned null',
    }
  }

  if (basicsResult.code !== 0) {
    if (spinner) {
      spinner.stop()
      spinner.fail(`Socket-basics scan failed (${elapsed}s)`)
    }
    debug('error', 'socket-basics failed:', basicsResult.stderr)
    return {
      ok: false,
      message: 'Socket-basics scan failed',
      cause: String(
        basicsResult.stderr || 'socket-basics exited with non-zero code',
      ),
    }
  }

  if (spinner) {
    spinner.stop()
    spinner.success(`Security scan completed (${elapsed}s)`)
  }

  // Verify .socket.facts.json was created.
  if (!existsSync(factsPath)) {
    return {
      ok: false,
      message: 'Socket facts file not created',
      cause: `Expected .socket.facts.json at: ${factsPath}`,
    }
  }

  // Parse findings from .socket.facts.json.
  const findings = await parseSocketFacts(factsPath)

  // Check if parsing failed.
  if (findings.error) {
    debug('warn', `Failed to parse facts JSON: ${findings.error}`)
    // Return success but with empty findings - the file exists so scan succeeded.
    return {
      ok: true,
      data: {
        factsPath,
        findings: {},
      },
    }
  }

  return {
    ok: true,
    data: {
      factsPath,
      findings,
    },
  }
}

/**
 * Parse .socket.facts.json to extract finding counts.
 *
 * @param factsPath - Path to .socket.facts.json file.
 * @returns Object with finding counts by category, or error if parsing failed.
 */
async function parseSocketFacts(factsPath: string): Promise<{
  containers?: number
  error?: string
  sast?: number
  secrets?: number
}> {
  try {
    const factsContent = await fs.readFile(factsPath, 'utf8')

    if (!factsContent || factsContent.trim() === '') {
      debug('error', 'Socket facts file is empty')
      return {
        error: 'Facts file is empty',
      }
    }

    let facts: any
    try {
      facts = JSON.parse(factsContent)
    } catch (parseError) {
      debug('error', 'Failed to parse socket facts JSON:', parseError)
      return {
        error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      }
    }

    // Extract finding counts from socket-basics output format.
    // The exact structure depends on socket-basics implementation.
    return {
      containers: facts.findings?.containers?.length || 0,
      sast: facts.findings?.sast?.length || 0,
      secrets: facts.findings?.secrets?.length || 0,
    }
  } catch (e) {
    debug('error', 'Failed to read socket facts file:', e)
    return {
      error: `File read error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
