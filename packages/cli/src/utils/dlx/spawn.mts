/**
 * DLX execution utilities for Socket CLI.
 * Manages package execution using Socket's own dlx implementation.
 *
 * Key Functions:
 * - spawnCdxgenDlx: Execute CycloneDX generator via dlx
 * - spawnCoanaDlx: Execute Coana CLI tool via dlx
 * - spawnDlx: Execute packages using Socket's dlx
 * - spawnSfwDlx: Execute Socket Firewall via dlx
 * - spawnSocketPyCli: Execute Socket Python CLI
 * - spawnSocketPatchDlx: Execute Socket Patch via dlx
 * - spawnSynpDlx: Execute Synp converter via dlx
 *
 * Implementation:
 * - Uses @socketsecurity/lib/dlx/package for direct package installation
 * - Installs packages to ~/.socket/_dlx directory
 * - Executes binaries directly without package manager commands
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { downloadBinary, getDlxCachePath } from '@socketsecurity/lib/dlx/binary'
import { detectExecutableType } from '@socketsecurity/lib/dlx/detect'
import { dlxPackage } from '@socketsecurity/lib/dlx/package'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  resolveCdxgen,
  resolveCoana,
  resolvePyCli,
  resolveSocketPatch,
  resolveSfw,
} from './resolve-binary.mjs'

import type { GitHubReleaseSpec } from './resolve-binary.mjs'
import {
  areExternalToolsAvailable,
  extractExternalTools,
} from './vfs-extract.mjs'
import {
  areBasicsToolsAvailable,
  extractBasicsTools,
  getBasicsToolPaths,
} from '../basics/vfs-extract.mts'
import { getDefaultOrgSlug } from '../../commands/ci/fetch-default-org-slug.mjs'
import { getCliVersion } from '../../env/cli-version.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'
import { getPythonBuildTag } from '../../env/python-build-tag.mts'
import { getPythonVersion } from '../../env/python-version.mts'
import { SOCKET_CLI_PYTHON_PATH } from '../../env/socket-cli-python-path.mts'
import { getSynpVersion } from '../../env/synp-version.mts'
import { getErrorCause, InputError } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'
import { spawnNode } from '../spawn/spawn-node.mjs'
import { getDefaultApiToken, getDefaultProxyUrl } from '../socket/sdk.mjs'

import type { IpcObject } from '../ipc.mts'
import type { CResult } from '../../types.mjs'
import type { ExternalTool } from './vfs-extract.mjs'
import type { SpawnExtra, SpawnOptions, SpawnResult } from '@socketsecurity/lib/spawn'

export type DlxSpawnOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type DlxSpawnResult = {
  spawnPromise: SpawnResult
}

export type DlxOptions = DlxSpawnOptions & {
  agent?: 'npm' | 'pnpm' | 'yarn' | undefined
  force?: boolean | undefined
  silent?: boolean | undefined
}

export type CoanaDlxOptions = DlxOptions & {
  coanaVersion?: string | undefined
}

export type DlxPackageSpec = {
  binaryName?: string | undefined
  name: string
  version: string
}

/**
 * Validate package name to prevent command injection.
 * Package names must follow npm naming rules.
 */
function validatePackageName(name: string): void {
  // Basic validation: no shell metacharacters, must be valid npm package name.
  // npm package names can contain: lowercase letters, numbers, hyphens, underscores, dots, and @ for scopes.
  const validNamePattern =
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

  if (!validNamePattern.test(name)) {
    throw new InputError(
      `Invalid package name "${name}". Package names must contain only lowercase letters, numbers, hyphens, underscores, dots, and optionally a scope (@org/package).`,
    )
  }

  // Check for path traversal attempts.
  if (name.includes('..') || (name.includes('/') && !name.startsWith('@'))) {
    throw new InputError(
      `Invalid package name "${name}". Package names cannot contain path traversal sequences.`,
    )
  }
}

/**
 * Spawns a package using Socket's dlx implementation.
 * Installs packages to ~/.socket/_dlx and executes them directly.
 */
export async function spawnDlx(
  packageSpec: DlxPackageSpec,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const { force = false, ...spawnOpts } = options ?? {}

  // Validate package name for security.
  validatePackageName(packageSpec.name)

  const packageString = `${packageSpec.name}@${packageSpec.version}`

  // Use Socket's dlxPackage to install and execute.
  const result = await dlxPackage(
    args,
    {
      package: packageString,
      binaryName: packageSpec.binaryName,
      force,
      spawnOptions: spawnOpts,
    },
    spawnExtra,
  )

  return {
    spawnPromise: result.spawnPromise as unknown as SpawnResult,
  }
}

/**
 * Download and cache a binary from GitHub releases.
 * Handles both .tar.gz and .zip archives, extracting the binary to the dlx cache.
 *
 * Security:
 * - Uses lock files to prevent TOCTOU race conditions during concurrent downloads.
 * - Validates zip entries for path traversal attacks before extraction.
 *
 * @param spec - GitHub release specification.
 * @returns Path to the downloaded binary.
 */
async function downloadGitHubReleaseBinary(
  spec: GitHubReleaseSpec,
): Promise<string> {
  const { assetName, binaryName, owner, repo, version } = spec
  const isPlatWin = os.platform() === 'win32'
  const binaryFileName = binaryName + (isPlatWin ? '.exe' : '')

  // Cache path: ~/.socket/_dlx/github/{owner}/{repo}/{version}/
  const cacheDir = path.join(
    getDlxCachePath(),
    'github',
    owner,
    repo,
    version,
  )
  const normalizedCacheDir = path.resolve(cacheDir)
  const binaryPath = path.join(cacheDir, binaryFileName)
  const lockFile = path.join(cacheDir, '.downloading')

  // Check if already downloaded.
  if (existsSync(binaryPath)) {
    return binaryPath
  }

  await safeMkdir(cacheDir)

  // TOCTOU protection: use lock file to prevent concurrent downloads.
  try {
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'EEXIST') {
      // Another process is downloading; wait for completion.
      for (let i = 0; i < 60; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
          setTimeout(resolve, 1_000)
        })
        if (existsSync(binaryPath)) {
          return binaryPath
        }
        // Check if lock holder is still alive.
        if (i % 5 === 4) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0)
              } catch {
                // Process died, lock is stale - remove and retry.
                // eslint-disable-next-line no-await-in-loop
                await fs.unlink(lockFile).catch(() => {})
                return downloadGitHubReleaseBinary(spec)
              }
            }
          } catch {
            // Lock file gone, retry.
            return downloadGitHubReleaseBinary(spec)
          }
        }
      }
      throw new InputError('Timeout waiting for another process to download GitHub release')
    }
    throw e
  }

  try {
    // Re-check after acquiring lock (another process may have finished).
    if (existsSync(binaryPath)) {
      return binaryPath
    }

    // Download the archive using downloadBinary (handles caching internally).
    const url = `https://github.com/${owner}/${repo}/releases/download/${version}/${assetName}`

    const result = await downloadBinary({
      name: `${owner}-${repo}-${version}-${assetName}`,
      url,
    })

    // Extract based on archive type.
    const isZip = assetName.endsWith('.zip')
    const isTarGz = assetName.endsWith('.tar.gz') || assetName.endsWith('.tgz')

    if (isZip) {
      // Extract zip using adm-zip (cross-platform, zero dependencies).
      const zip = new AdmZip(result.binaryPath)

      // Security: validate all entries for path traversal before extraction.
      const entries = zip.getEntries()
      for (const entry of entries) {
        const entryPath = path.resolve(path.join(cacheDir, entry.entryName))
        if (!entryPath.startsWith(normalizedCacheDir)) {
          throw new InputError(
            `Archive contains path traversal: ${entry.entryName}. ` +
              `This may indicate a compromised release asset.`,
          )
        }
      }

      zip.extractAllTo(cacheDir, true)
    } else if (isTarGz) {
      // Extract tar.gz using system tar.
      // Note: tar has built-in path traversal protection by default.
      const { whichReal } = await import('@socketsecurity/lib/bin')
      const tarPath = await whichReal('tar', { nothrow: true })
      if (!tarPath || Array.isArray(tarPath)) {
        throw new InputError(
          'tar is required to extract GitHub release archives. Please install tar for your system.',
        )
      }
      await spawn(tarPath, ['-xzf', result.binaryPath, '-C', cacheDir], {})
    } else {
      throw new InputError(`Unsupported archive format: ${assetName}`)
    }

    // Verify binary was extracted.
    if (!existsSync(binaryPath)) {
      throw new InputError(
        `Binary ${binaryFileName} not found after extracting ${assetName}. ` +
          `Expected at: ${binaryPath}`,
      )
    }

    // Make executable on Unix.
    if (!isPlatWin) {
      await fs.chmod(binaryPath, 0o755)
    }

    return binaryPath
  } finally {
    // Clean up lock file.
    try {
      await fs.unlink(lockFile)
    } catch {
      // Ignore cleanup errors.
    }
  }
}

/**
 * Helper to spawn Coana with dlx.
 * Returns a CResult with stdout extraction for backward compatibility.
 *
 * If SOCKET_CLI_COANA_LOCAL_PATH environment variable is set, uses the local
 * Coana CLI at that path instead of downloading from npm.
 */
export async function spawnCoanaDlx(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    env: spawnEnv,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: getCliVersion(),
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  if (orgSlug) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlug
  } else {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (orgSlugCResult.ok) {
      mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
    }
  }

  const proxyUrl = getDefaultProxyUrl()
  if (proxyUrl) {
    mixinsEnv['SOCKET_CLI_API_PROXY'] = proxyUrl
  }

  try {
    const resolution = resolveCoana()

    // Use local Coana CLI if available.
    if (resolution.type === 'local') {
      const detection = detectExecutableType(resolution.path)

      const finalEnv = {
        ...process.env,
        ...mixinsEnv,
        ...spawnEnv,
      }

      const spawnArgs =
        detection.type === 'binary' ? args : [resolution.path, ...args]
      const spawnCommand =
        detection.type === 'binary' ? resolution.path : 'node'

      const spawnPromise = spawn(spawnCommand, spawnArgs, {
        ...dlxOptions,
        env: finalEnv,
        stdio: spawnExtra?.['stdio'] || 'inherit',
      })

      const output = await spawnPromise

      return {
        ok: true,
        data: output.stdout?.toString() ?? '',
      }
    }

    // Use dlx version (resolveCoana only returns 'local' or 'dlx' types).
    if (resolution.type !== 'dlx') {
      throw new Error('Unexpected resolution type for coana')
    }
    const result = await spawnDlx(
      {
        ...resolution.details,
        version: coanaVersion || resolution.details.version,
      },
      args,
      {
        force: true,
        ...dlxOptions,
        env: {
          ...process.env,
          ...mixinsEnv,
          ...spawnEnv,
        },
      },
      spawnExtra,
    )
    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const cause = getErrorCause(e)
    const message = stderr || cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}

/**
 * Helper to spawn cdxgen with dlx.
 * If SOCKET_CLI_CDXGEN_LOCAL_PATH environment variable is set, uses the local
 * cdxgen binary at that path instead of downloading from npm.
 */
export async function spawnCdxgenDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveCdxgen()

  // Use local cdxgen if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnArgs =
      detection.type === 'binary' ? args : [resolution.path, ...args]
    const spawnCommand = detection.type === 'binary' ? resolution.path : 'node'

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version (resolveCdxgen only returns 'local' or 'dlx' types).
  if (resolution.type !== 'dlx') {
    throw new Error('Unexpected resolution type for cdxgen')
  }
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

/**
 * Helper to spawn Socket Firewall (sfw) with dlx.
 * If SOCKET_CLI_SFW_LOCAL_PATH environment variable is set, uses the local
 * sfw binary at that path instead of downloading from npm.
 */
export async function spawnSfwDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveSfw()

  // Use local sfw if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const spawnArgs =
      detection.type === 'binary' ? args : [resolution.path, ...args]
    const spawnCommand = detection.type === 'binary' ? resolution.path : 'node'

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version (resolveSfw only returns 'local' or 'dlx' types).
  if (resolution.type !== 'dlx') {
    throw new Error('Unexpected resolution type for sfw')
  }
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

/**
 * Helper to spawn Socket Patch.
 * If SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH environment variable is set, uses the local
 * socket-patch binary at that path instead of downloading.
 *
 * Note: As of v2.0.0, socket-patch is a Rust binary downloaded from GitHub releases,
 * not an npm package. This function handles both local overrides and GitHub downloads.
 */
export async function spawnSocketPatchDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveSocketPatch()
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as DlxOptions

  // Use local socket-patch if available.
  if (resolution.type === 'local') {
    const detection = detectExecutableType(resolution.path)

    const spawnArgs =
      detection.type === 'binary' ? args : [resolution.path, ...args]
    const spawnCommand = detection.type === 'binary' ? resolution.path : 'node'

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Download from GitHub releases (socket-patch v2.0.0+).
  if (resolution.type === 'github-release') {
    const binaryPath = await downloadGitHubReleaseBinary(resolution.details)

    const spawnPromise = spawn(binaryPath, args, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio: spawnExtra?.['stdio'] || 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Fallback to dlx for npm packages (not used for socket-patch v2.0.0+).
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

/**
 * Helper to spawn synp with dlx.
 */
export async function spawnSynpDlx(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnDlx(
    {
      name: 'synp',
      version: getSynpVersion(),
    },
    args,
    { force: false, ...options },
    spawnExtra,
  )
}

/**
 * VFS-based spawn functions for SEA binaries.
 * These extract tools from VFS and execute them directly.
 */

/**
 * Helper to spawn a tool from VFS extraction.
 * Used when running in SEA mode.
 */
async function spawnToolVfs(
  tool: ExternalTool,
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (!areExternalToolsAvailable()) {
    throw new Error(
      `Cannot spawn ${tool} from VFS - tools not available in SEA mode`,
    )
  }

  // Extract tools from VFS (returns paths directly).
  const toolPaths = await extractExternalTools()
  if (!toolPaths) {
    throw new Error(`Failed to extract ${tool} from VFS`)
  }

  // Get tool path.
  const toolPath = toolPaths[tool]

  if (!toolPath) {
    throw new Error(`Tool path not found for ${tool}`)
  }

  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as DlxOptions

  // Spawn tool directly.
  const spawnPromise = spawn(toolPath, args, {
    ...dlxOptions,
    env: {
      ...process.env,
      ...spawnEnv,
    },
    stdio: spawnExtra?.['stdio'] || 'inherit',
  })

  return {
    spawnPromise,
  }
}

/**
 * Helper to spawn Socket Firewall (sfw) from VFS.
 * Used when running in SEA mode.
 */
export async function spawnSfwVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('sfw', args, options, spawnExtra)
}

/**
 * Helper to spawn cdxgen from VFS.
 * Used when running in SEA mode.
 */
export async function spawnCdxgenVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('cdxgen', args, options, spawnExtra)
}

/**
 * Helper to spawn Coana from VFS.
 * Used when running in SEA mode.
 */
export async function spawnCoanaVfs(
  args: string[] | readonly string[],
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    coanaVersion,
    env: spawnEnv,
    ...dlxOptions
  } = {
    __proto__: null,
    ...options,
  } as CoanaDlxOptions

  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: getCliVersion(),
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  const orgSlugCResult = await getDefaultOrgSlug()
  if (orgSlugCResult.ok) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
  }

  const proxyUrl = getDefaultProxyUrl()
  if (proxyUrl) {
    mixinsEnv['SOCKET_CLI_API_PROXY'] = proxyUrl
  }

  try {
    const result = await spawnToolVfs('coana', args, {
      ...dlxOptions,
      env: {
        ...process.env,
        ...mixinsEnv,
        ...spawnEnv,
      },
    }, spawnExtra)

    const output = await result.spawnPromise
    return {
      ok: true,
      data: output.stdout?.toString() ?? '',
    }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const cause = getErrorCause(e)
    const message = stderr || cause
    return {
      ok: false,
      data: e,
      message,
    }
  }
}

/**
 * Helper to spawn Socket Patch from VFS.
 * Used when running in SEA mode.
 */
export async function spawnSocketPatchVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('socket-patch', args, options, spawnExtra)
}

/**
 * Helper to spawn synp from VFS.
 * Used when running in SEA mode.
 */
export async function spawnSynpVfs(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  return await spawnToolVfs('synp', args, options, spawnExtra)
}

/**
 * High-level spawn functions that auto-detect SEA vs npm CLI mode.
 * These choose between VFS extraction (SEA) and dlx download (npm CLI).
 */

/**
 * Spawn Socket Firewall (sfw).
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnSfw(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnSfwVfs(args, options, spawnExtra)
  }
  return await spawnSfwDlx(args, options, spawnExtra)
}

/**
 * Spawn cdxgen (CycloneDX generator).
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnCdxgen(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnCdxgenVfs(args, options, spawnExtra)
  }
  return await spawnCdxgenDlx(args, options, spawnExtra)
}

/**
 * Spawn Coana CLI.
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnCoana(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: CoanaDlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnCoanaVfs(args, options, spawnExtra)
  }
  return await spawnCoanaDlx(args, orgSlug, options, spawnExtra)
}

/**
 * Spawn Socket Patch.
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnSocketPatch(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnSocketPatchVfs(args, options, spawnExtra)
  }
  return await spawnSocketPatchDlx(args, options, spawnExtra)
}

/**
 * Spawn synp (package.json converter).
 * Auto-detects SEA mode and uses appropriate spawn method.
 */
export async function spawnSynp(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  if (isSeaBinary() && areExternalToolsAvailable()) {
    return await spawnSynpVfs(args, options, spawnExtra)
  }
  return await spawnSynpDlx(args, options, spawnExtra)
}

/**
 * Python CLI spawn utilities.
 * These use bundled Python from SEA VFS or download portable Python via DLX.
 */

/**
 * Get the download URL for python-build-standalone based on platform and architecture.
 */
function getPythonStandaloneUrl(): string {
  const version = getPythonVersion()
  const tag = getPythonBuildTag()
  const platform = os.platform()
  const arch = os.arch()

  let platformTriple: string

  if (platform === 'darwin') {
    platformTriple =
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  } else if (platform === 'linux') {
    platformTriple =
      arch === 'arm64'
        ? 'aarch64-unknown-linux-gnu'
        : 'x86_64-unknown-linux-gnu'
  } else if (platform === 'win32') {
    // Windows ARM64 can use native ARM64 Python for better performance.
    platformTriple =
      arch === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : 'x86_64-pc-windows-msvc'
  } else {
    throw new InputError(`Unsupported platform: ${platform}`)
  }

  // URL encoding for the '+' in version string.
  const encodedVersion = `${version}%2B${tag}`
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/cpython-${encodedVersion}-${platformTriple}-install_only.tar.gz`
}

/**
 * Get the path to the cached Python installation directory.
 */
function getPythonCachePath(): string {
  const version = getPythonVersion()
  const tag = getPythonBuildTag()
  const platform = os.platform()
  const arch = os.arch()

  return path.join(
    getDlxCachePath(),
    'python',
    `${version}-${tag}-${platform}-${arch}`,
  )
}

/**
 * Get the path to the Python executable within the installation.
 */
function getPythonBinPath(pythonDir: string): string {
  if (WIN32) {
    return path.join(pythonDir, 'python', 'python.exe')
  }
  return path.join(pythonDir, 'python', 'bin', 'python3')
}

/**
 * Download and extract Python from python-build-standalone using downloadBinary.
 */
async function downloadPython(pythonDir: string): Promise<void> {
  const url = getPythonStandaloneUrl()
  const tarballName = 'python-standalone.tar.gz'

  await safeMkdir(pythonDir, { recursive: true })

  const result = await downloadBinary({
    name: tarballName,
    url,
  })

  // Extract the tarball to pythonDir.
  const { whichReal } = await import('@socketsecurity/lib/bin')
  const tarPath = await whichReal('tar', { nothrow: true })
  if (!tarPath || Array.isArray(tarPath)) {
    throw new InputError(
      'tar is required to extract Python. Please install tar for your system.',
    )
  }
  await spawn(tarPath, ['-xzf', result.binaryPath, '-C', pythonDir], {})
}

/**
 * Ensure Python is available (local override, SEA bundled, or DLX downloaded).
 * Returns the path to the Python executable.
 *
 * Resolution order:
 * 1. SOCKET_CLI_PYTHON_PATH environment variable (local development)
 * 2. Bundled Python from SEA VFS (SEA binary installations)
 * 3. Portable Python download via DLX (npm/pnpm/yarn installations)
 */
export async function ensurePython(): Promise<string> {
  // Check for local Python path override.
  if (SOCKET_CLI_PYTHON_PATH) {
    return SOCKET_CLI_PYTHON_PATH
  }

  // Use bundled Python from VFS in SEA mode.
  if (isSeaBinary() && areBasicsToolsAvailable()) {
    const toolsDir = await extractBasicsTools()
    if (toolsDir) {
      const toolPaths = getBasicsToolPaths(toolsDir)
      return toolPaths.python
    }
  }

  // Fallback to DLX-downloaded Python.
  return await ensurePythonDlx()
}

/**
 * Ensure Python is available via DLX download.
 * Returns the path to the Python executable.
 * Uses lock file to prevent concurrent downloads (TOCTOU protection).
 *
 * @param retryCount Internal retry counter to prevent unbounded recursion.
 */
export async function ensurePythonDlx(retryCount = 0): Promise<string> {
  const MAX_RETRIES = 3

  if (retryCount >= MAX_RETRIES) {
    throw new InputError(
      `Failed to acquire Python installation lock after ${MAX_RETRIES} retries. ` +
        'Please check for filesystem issues or competing processes.',
    )
  }

  const pythonDir = getPythonCachePath()
  const pythonBin = getPythonBinPath(pythonDir)
  const lockFile = path.join(pythonDir, '.downloading')

  if (!existsSync(pythonBin)) {
    await safeMkdir(pythonDir, { recursive: true })

    // Try to acquire lock atomically.
    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code === 'EEXIST') {
        // Check if lock is stale by reading PID.
        let isStale = false
        try {
          const lockPid = await fs.readFile(lockFile, 'utf8')
          const pid = Number.parseInt(lockPid.trim(), 10)
          if (!Number.isNaN(pid) && pid > 0) {
            try {
              // Signal 0 checks process existence without sending actual signal.
              process.kill(pid, 0)
              // Process exists, lock is valid.
            } catch (pidError) {
              const pidErr = pidError as NodeJS.ErrnoException
              // EPERM means process exists but no permission (treat as alive).
              // ESRCH means process doesn't exist (dead).
              if (pidErr.code !== 'EPERM') {
                isStale = true
              }
            }
          } else {
            isStale = true
          }
        } catch {
          // Could not read lock file, may have been removed.
          isStale = true
        }

        if (isStale) {
          // Stale lock detected, remove and retry.
          await fs.unlink(lockFile).catch(() => {})
          return ensurePythonDlx(retryCount + 1)
        }

        // Lock is valid, wait for download to complete.
        for (let i = 0; i < 60; i++) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => {
            setTimeout(resolve, 1_000)
          })
          if (existsSync(pythonBin)) {
            return pythonBin
          }
        }
        throw new InputError('Timeout waiting for Python download by another process')
      }
      throw e
    }

    try {
      await downloadPython(pythonDir)

      if (!existsSync(pythonBin)) {
        throw new InputError(
          `Python binary not found after extraction: ${pythonBin}`,
        )
      }

      // Make executable on POSIX.
      if (!WIN32) {
        await fs.chmod(pythonBin, 0o755)
      }
    } finally {
      // Clean up lock file.
      try {
        await fs.unlink(lockFile)
      } catch {
        // Ignore cleanup errors.
      }
    }
  }

  return pythonBin
}

/**
 * Check if socketcli is installed in the Python environment.
 */
async function isSocketPyCliInstalled(pythonBin: string): Promise<boolean> {
  try {
    const result = await spawn(
      pythonBin,
      ['-c', 'import socketsecurity.socketcli'],
      { shell: WIN32 },
    )
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Convert npm caret range (^2.2.15) to pip version specifier (>=2.2.15,<3.0.0).
 */
function convertCaretToPipRange(caretRange: string): string {
  if (!caretRange) {
    return ''
  }

  if (!caretRange.startsWith('^')) {
    return `==${caretRange}`
  }

  const version = caretRange.slice(1) // Remove '^'.

  // Handle malformed caret range (just "^" with no version).
  if (!version) {
    return ''
  }

  const parts = version.split('.')
  const major = Number.parseInt(parts[0] || '0', 10)
  // Handle non-numeric major version (e.g., "^x.2.3").
  if (Number.isNaN(major)) {
    return `==${version}`
  }
  const nextMajor = major + 1

  return `>=${version},<${nextMajor}.0.0`
}

/**
 * Install socketsecurity package into the Python environment.
 * Uses lock file to prevent race conditions when multiple processes
 * try to install simultaneously.
 *
 * @param pythonBin Path to Python executable.
 * @param retryCount Internal retry counter to prevent unbounded recursion.
 */
export async function ensureSocketPyCli(
  pythonBin: string,
  retryCount = 0,
): Promise<void> {
  const MAX_RETRIES = 3

  if (retryCount >= MAX_RETRIES) {
    throw new InputError(
      `Failed to acquire Socket Python CLI installation lock after ${MAX_RETRIES} retries. ` +
        'Please check for filesystem issues or competing processes.',
    )
  }

  if (await isSocketPyCliInstalled(pythonBin)) {
    return
  }

  // Create lock file to prevent concurrent installation.
  const pythonDir = path.dirname(pythonBin)
  const lockFile = path.join(pythonDir, '.installing-socketcli')

  try {
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException
    if (error.code === 'EEXIST') {
      // Check if lock is stale by reading PID.
      let isStale = false
      try {
        const lockPid = await fs.readFile(lockFile, 'utf8')
        const pid = Number.parseInt(lockPid.trim(), 10)
        if (!Number.isNaN(pid) && pid > 0) {
          try {
            // Signal 0 checks process existence.
            process.kill(pid, 0)
            // Process exists, lock is valid.
          } catch (pidError) {
            const pidErr = pidError as NodeJS.ErrnoException
            // EPERM means process exists but no permission (treat as alive).
            // ESRCH means process doesn't exist (dead).
            if (pidErr.code !== 'EPERM') {
              isStale = true
            }
          }
        } else {
          isStale = true
        }
      } catch {
        // Could not read lock file, may have been removed.
        isStale = true
      }

      if (isStale) {
        // Stale lock detected, remove and retry immediately.
        await fs.unlink(lockFile).catch(() => {})
        return ensureSocketPyCli(pythonBin, retryCount + 1)
      }

      // Lock is valid, wait for installation to complete.
      for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
          setTimeout(resolve, 1_000)
        })
        // eslint-disable-next-line no-await-in-loop
        if (await isSocketPyCliInstalled(pythonBin)) {
          return
        }
        // Periodically re-check if lock holder is still alive.
        if (i % 5 === 4) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0)
              } catch (pidError) {
                const pidErr = pidError as NodeJS.ErrnoException
                if (pidErr.code !== 'EPERM') {
                  // Lock holder died during wait, retry.
                  // eslint-disable-next-line no-await-in-loop
                  await fs.unlink(lockFile).catch(() => {})
                  return ensureSocketPyCli(pythonBin, retryCount + 1)
                }
              }
            }
          } catch {
            // Lock file gone, retry.
            return ensureSocketPyCli(pythonBin, retryCount + 1)
          }
        }
      }
      // Timeout after 30 seconds, retry anyway.
      return ensureSocketPyCli(pythonBin, retryCount + 1)
    }
    throw e
  }

  try {
    const pyCliVersion = getPyCliVersion()
    const versionSpec = convertCaretToPipRange(pyCliVersion)
    const packageSpec = versionSpec
      ? `socketsecurity${versionSpec}`
      : 'socketsecurity'

    await spawn(pythonBin, ['-m', 'pip', 'install', '--quiet', packageSpec], {
      shell: WIN32,
      stdio: 'inherit',
    })
  } finally {
    // Clean up lock file.
    try {
      await fs.unlink(lockFile)
    } catch {
      // Ignore cleanup errors.
    }
  }
}

export type SocketPyCliDlxOptions = DlxOptions

/**
 * Spawn socketcli via bundled Python from SEA VFS.
 * Uses the same Python as socket-basics for consistency.
 */
export async function spawnSocketPyCliVfs(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  try {
    const toolsDir = await extractBasicsTools()
    if (!toolsDir) {
      return {
        data: new Error('Failed to extract basics tools from VFS'),
        message: 'Failed to extract basics tools from VFS',
        ok: false,
      }
    }

    const toolPaths = getBasicsToolPaths(toolsDir)
    const pythonBin = toolPaths.python

    // Ensure socketsecurity package is installed.
    const pyCliVersion = getPyCliVersion()
    await spawn(
      pythonBin,
      ['-m', 'pip', 'install', '--quiet', `socketsecurity==${pyCliVersion}`],
      { stdio: 'pipe' },
    )

    // Run socketcli with isolated PATH.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: {
          ...process.env,
          ...spawnEnv,
          // Isolate PATH to bundled tools only.
          PATH: `${path.dirname(pythonBin)}:${toolsDir}`,
        },
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}

/**
 * Spawn socketcli via DLX-downloaded Python.
 * Downloads portable Python from python-build-standalone and installs socketsecurity.
 */
export async function spawnSocketPyCliDlx(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  const resolution = resolvePyCli()

  const finalEnv: Record<string, string | undefined> = {
    ...process.env,
    ...spawnEnv,
  }

  try {
    // Use local Python CLI if available.
    if (resolution.type === 'local') {
      const spawnNodeOpts: any = {
        ...(dlxOptions.cwd ? { cwd: dlxOptions.cwd } : {}),
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      }
      const spawnResult = await spawnNode([resolution.path, ...args], spawnNodeOpts)

      return {
        data: spawnResult.stdout?.toString() ?? '',
        ok: true,
      }
    }

    // Download portable Python via DLX infrastructure.
    const pythonBin = await ensurePythonDlx()

    // Ensure socketsecurity is installed.
    await ensureSocketPyCli(pythonBin)

    // Run socketcli via python -m.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}

/**
 * Spawn socketcli (Socket Python CLI).
 * Ensures Python is available (SEA bundled or DLX downloaded) before spawning.
 *
 * Resolution order:
 * 1. SOCKET_CLI_PYCLI_LOCAL_PATH environment variable (local development)
 * 2. Bundled Python from SEA VFS (SEA binary installations)
 * 3. Portable Python download via DLX (npm/pnpm/yarn installations)
 */
export async function spawnSocketPyCli(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  const finalEnv: Record<string, string | undefined> = {
    ...process.env,
    ...spawnEnv,
  }

  try {
    // Check for local path override first.
    const resolution = resolvePyCli()
    if (resolution.type === 'local') {
      const spawnNodeOpts: any = {
        ...(dlxOptions.cwd ? { cwd: dlxOptions.cwd } : {}),
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      }
      const spawnResult = await spawnNode([resolution.path, ...args], spawnNodeOpts)

      return {
        data: spawnResult.stdout?.toString() ?? '',
        ok: true,
      }
    }

    // Ensure Python is available (SEA bundled or DLX downloaded).
    const pythonBin = await ensurePython()

    // Ensure socketsecurity package is installed.
    await ensureSocketPyCli(pythonBin)

    // Build environment - isolate PATH for SEA mode.
    const spawnEnvFinal = isSeaBinary() && areBasicsToolsAvailable()
      ? {
          ...finalEnv,
          // Isolate PATH to bundled tools directory for SEA.
          PATH: `${path.dirname(pythonBin)}:${path.dirname(path.dirname(pythonBin))}`,
        }
      : finalEnv

    // Run socketcli via python -m.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: spawnEnvFinal,
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}
