/**
 * @fileoverview DLX package execution - Install and execute npm packages.
 *
 * This module provides functionality to install and execute npm packages
 * in the ~/.socket/_dlx directory, similar to npx but with Socket's own cache.
 *
 * Uses content-addressed storage like npm's _npx:
 * - Hash is generated from package spec (name@version)
 * - Each unique spec gets its own directory: ~/.socket/_dlx/<hash>/
 * - Allows caching multiple versions of the same package
 *
 * Concurrency protection:
 * - Uses process-lock to prevent concurrent installation corruption
 * - Lock file created at ~/.socket/_dlx/<hash>/concurrency.lock
 * - Uses npm npx's concurrency.lock naming convention (5s stale, 2s touching)
 * - Prevents multiple processes from corrupting the same package installation
 *
 * Version range handling:
 * - Exact versions (1.0.0) use cache if available
 * - Range versions (^1.0.0, ~1.0.0) auto-force to get latest within range
 * - User can override with explicit force: false
 *
 * Key difference from dlx-binary.ts:
 * - dlx-binary.ts: Downloads standalone binaries from URLs
 * - dlx-package.ts: Installs npm packages from registries
 *
 * Implementation:
 * - Uses pacote for package installation (no npm CLI required)
 * - Split into downloadPackage() and executePackage() for flexibility
 * - dlxPackage() combines both for convenience
 */

import path from 'path'

import { WIN32 } from './constants/platform'
import { getPacoteCachePath } from './constants/packages'
import { generateCacheKey } from './dlx'
import { readJsonSync, safeMkdir } from './fs'
import { normalizePath } from './path'
import { getSocketDlxDir } from './paths'
import { processLock } from './process-lock'
import type { SpawnExtra, SpawnOptions } from './spawn'
import { spawn } from './spawn'

let _fs: typeof import('fs') | undefined
/**
 * Lazily load the fs module to avoid Webpack errors.
 * Uses non-'node:' prefixed require to prevent Webpack bundling issues.
 *
 * @returns The Node.js fs module
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getFs() {
  if (_fs === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _fs = /*@__PURE__*/ require('node:fs')
  }
  return _fs as typeof import('fs')
}

let _npmPackageArg: typeof import('npm-package-arg') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getNpmPackageArg() {
  if (_npmPackageArg === undefined) {
    _npmPackageArg = /*@__PURE__*/ require('npm-package-arg')
  }
  return _npmPackageArg as typeof import('npm-package-arg')
}

let _libnpmexec: typeof import('libnpmexec') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getLibnpmexec() {
  if (_libnpmexec === undefined) {
    _libnpmexec = /*@__PURE__*/ require('libnpmexec')
  }
  return _libnpmexec!
}

let _pacote: typeof import('pacote') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getPacote() {
  if (_pacote === undefined) {
    _pacote = /*@__PURE__*/ require('pacote')
  }
  return _pacote as typeof import('pacote')
}

/**
 * Regex to check if a version string contains range operators.
 * Matches any version with range operators: ~, ^, >, <, =, x, X, *, spaces, or ||.
 */
const rangeOperatorsRegExp = /[~^><=xX* ]|\|\|/

export interface DownloadPackageResult {
  /** Path to the installed package directory. */
  packageDir: string
  /** Path to the binary. */
  binaryPath: string
  /** Whether the package was newly installed. */
  installed: boolean
}

export interface DlxPackageOptions {
  /**
   * Package to install (e.g., '@cyclonedx/cdxgen@10.0.0').
   * Aligns with npx --package flag.
   */
  package: string

  /**
   * Binary name to execute (optional - auto-detected in most cases).
   *
   * Auto-detection logic:
   * 1. If package has only one binary, uses it automatically
   * 2. Tries user-provided binaryName
   * 3. Tries last segment of package name (e.g., 'cli' from '@socketsecurity/cli')
   * 4. Falls back to first binary
   *
   * Only needed when package has multiple binaries and auto-detection fails.
   *
   * @example
   * // Auto-detected (single binary)
   * { package: '@socketsecurity/cli' }  // Finds 'socket' binary automatically
   *
   * // Explicit (multiple binaries)
   * { package: 'some-tool', binaryName: 'specific-tool' }
   */
  binaryName?: string | undefined

  /**
   * Force reinstallation even if package exists.
   * Aligns with npx --yes/-y flag behavior.
   */
  force?: boolean | undefined

  /**
   * Skip confirmation prompts (auto-approve).
   * Aligns with npx --yes/-y flag.
   */
  yes?: boolean | undefined

  /**
   * Suppress output (quiet mode).
   * Aligns with npx --quiet/-q and pnpm --silent/-s flags.
   */
  quiet?: boolean | undefined

  /**
   * Additional spawn options for the execution.
   */
  spawnOptions?: SpawnOptions | undefined
}

export interface DlxPackageResult {
  /** Path to the installed package directory. */
  packageDir: string
  /** Path to the binary that was executed. */
  binaryPath: string
  /** Whether the package was newly installed. */
  installed: boolean
  /** The spawn promise for the running process. */
  spawnPromise: ReturnType<typeof spawn>
}

/**
 * Parse package spec into name and version using npm-package-arg.
 * Examples:
 * - 'lodash@4.17.21' → { name: 'lodash', version: '4.17.21' }
 * - '@scope/pkg@1.0.0' → { name: '@scope/pkg', version: '1.0.0' }
 * - 'lodash' → { name: 'lodash', version: undefined }
 */
function parsePackageSpec(spec: string): {
  name: string
  version: string | undefined
} {
  try {
    const npa = getNpmPackageArg()
    const parsed = npa(spec)

    // Extract version from different types of specs.
    // For registry specs, use fetchSpec (the version/range).
    // For git/file/etc, version will be undefined.
    const version =
      parsed.type === 'tag'
        ? parsed.fetchSpec
        : parsed.type === 'version' || parsed.type === 'range'
          ? parsed.fetchSpec
          : undefined

    return {
      name: parsed.name || spec,
      version,
    }
  } catch {
    // Fallback to simple parsing if npm-package-arg fails.
    const atIndex = spec.lastIndexOf('@')
    if (atIndex === -1 || spec.startsWith('@')) {
      // No version or scoped package without version.
      return { name: spec, version: undefined }
    }
    return {
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    }
  }
}

/**
 * Install package to ~/.socket/_dlx/<hash>/ if not already installed.
 * Uses pacote for installation (no npm CLI required).
 * Protected by process lock to prevent concurrent installation corruption.
 */
async function ensurePackageInstalled(
  packageName: string,
  packageSpec: string,
  force: boolean,
): Promise<{ installed: boolean; packageDir: string }> {
  const cacheKey = generateCacheKey(packageSpec)
  const packageDir = normalizePath(path.join(getSocketDlxDir(), cacheKey))
  const installedDir = normalizePath(
    path.join(packageDir, 'node_modules', packageName),
  )

  // Ensure package directory exists before creating lock.
  // The lock directory will be created inside this directory.
  try {
    await safeMkdir(packageDir)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied creating package directory: ${packageDir}\n` +
          'Please check directory permissions or run with appropriate access.',
        { cause: e },
      )
    }
    if (code === 'EROFS') {
      throw new Error(
        `Cannot create package directory on read-only filesystem: ${packageDir}\n` +
          'Ensure the filesystem is writable or set SOCKET_DLX_DIR to a writable location.',
        { cause: e },
      )
    }
    throw new Error(`Failed to create package directory: ${packageDir}`, {
      cause: e,
    })
  }

  // Use process lock to prevent concurrent installations.
  // Uses npm npx's concurrency.lock naming convention.
  const lockPath = path.join(packageDir, 'concurrency.lock')

  return await processLock.withLock(
    lockPath,
    async () => {
      const fs = getFs()
      // Double-check if already installed (unless force).
      // Another process may have installed while waiting for lock.
      if (!force && fs.existsSync(installedDir)) {
        // Verify package.json exists.
        const pkgJsonPath = path.join(installedDir, 'package.json')
        if (fs.existsSync(pkgJsonPath)) {
          return { installed: false, packageDir }
        }
      }

      // Use pacote to extract the package.
      // Pacote leverages npm cache when available but doesn't require npm CLI.
      const pacoteCachePath = getPacoteCachePath()
      try {
        await getPacote().extract(packageSpec, installedDir, {
          // Use consistent pacote cache path (respects npm cache locations when available).
          cache: pacoteCachePath || path.join(packageDir, '.cache'),
        })
      } catch (e) {
        const code = (e as any).code
        if (code === 'E404' || code === 'ETARGET') {
          throw new Error(
            `Package not found: ${packageSpec}\n` +
              'Verify the package exists on npm registry and check the version.\n' +
              `Visit https://www.npmjs.com/package/${packageName} to see available versions.`,
            { cause: e },
          )
        }
        if (
          code === 'ENOTFOUND' ||
          code === 'ETIMEDOUT' ||
          code === 'EAI_AGAIN'
        ) {
          throw new Error(
            `Network error installing ${packageSpec}\n` +
              'Check your internet connection and try again.',
            { cause: e },
          )
        }
        throw new Error(
          `Failed to install package: ${packageSpec}\n` +
            `Destination: ${installedDir}\n` +
            'Check npm registry connectivity or package name.',
          { cause: e },
        )
      }

      return { installed: true, packageDir }
    },
    {
      // Align with npm npx locking strategy.
      staleMs: 5000,
      touchIntervalMs: 2000,
    },
  )
}

/**
 * Resolve binary path with cross-platform wrapper support.
 * On Windows, checks for .cmd, .bat, .ps1, .exe wrappers in order.
 * On Unix, uses path directly.
 *
 * Aligns with npm/npx binary resolution strategy.
 */
function resolveBinaryPath(basePath: string): string {
  const fs = getFs()

  if (!WIN32) {
    // Unix: use path directly
    return basePath
  }

  // Windows: check for wrappers in priority order
  // Order matches npm bin-links creation: .cmd, .ps1, .exe, then bare
  const extensions = ['.cmd', '.bat', '.ps1', '.exe', '']

  for (const ext of extensions) {
    const testPath = basePath + ext
    if (fs.existsSync(testPath)) {
      return testPath
    }
  }

  // Fallback to original path if no wrapper found
  return basePath
}

/**
 * Find the binary path for an installed package.
 * Uses npm's bin resolution strategy with user-friendly fallbacks.
 * Resolves platform-specific wrappers (.cmd, .ps1, etc.) on Windows.
 *
 * Resolution strategy (cherry-picked from libnpmexec):
 * 1. Use npm's getBinFromManifest (handles aliases and standard cases)
 * 2. Fall back to user-provided binaryName if npm's strategy fails
 * 3. Try last segment of package name as final fallback
 * 4. Use first binary as last resort
 */
function findBinaryPath(
  packageDir: string,
  packageName: string,
  binaryName?: string,
): string {
  const installedDir = normalizePath(
    path.join(packageDir, 'node_modules', packageName),
  )
  const pkgJsonPath = path.join(installedDir, 'package.json')

  // Read package.json to find bin entry.
  const pkgJson = readJsonSync(pkgJsonPath) as Record<string, unknown>
  const bin = pkgJson['bin']

  let binName: string | undefined
  let binPath: string | undefined

  if (typeof bin === 'string') {
    // Single binary - use it directly.
    binPath = bin
  } else if (typeof bin === 'object' && bin !== null) {
    const binObj = bin as Record<string, string>
    const binKeys = Object.keys(binObj)

    // If only one binary, use it regardless of name.
    if (binKeys.length === 1) {
      binName = binKeys[0]!
      binPath = binObj[binName]
    } else {
      // Multiple binaries - use npm's battle-tested resolution strategy first.
      try {
        const { getBinFromManifest } = getLibnpmexec()
        binName = getBinFromManifest({
          name: packageName,
          bin: binObj,
          _id: `${packageName}@${(pkgJson as any).version || 'unknown'}`,
        })
        binPath = binObj[binName]
      } catch {
        // npm's strategy failed - fall back to user-friendly resolution:
        // 1. User-provided binaryName
        // 2. Last segment of package name (e.g., 'cli' from '@socketsecurity/cli')
        // 3. First binary as fallback
        const lastSegment = packageName.split('/').pop()
        const candidates = [
          binaryName,
          lastSegment,
          packageName.replace(/^@[^/]+\//, ''),
        ].filter(Boolean)

        for (const candidate of candidates) {
          if (candidate && binObj[candidate]) {
            binName = candidate
            binPath = binObj[candidate]
            break
          }
        }

        // Fallback to first binary if nothing matched.
        if (!binPath && binKeys.length > 0) {
          binName = binKeys[0]!
          binPath = binObj[binName]
        }
      }
    }
  }

  if (!binPath) {
    throw new Error(`No binary found for package "${packageName}"`)
  }

  const rawPath = normalizePath(path.join(installedDir, binPath))

  // Resolve platform-specific wrapper (Windows .cmd/.ps1/etc.)
  return resolveBinaryPath(rawPath)
}

/**
 * Execute a package via DLX - install if needed and run its binary.
 *
 * This is the Socket equivalent of npx/pnpm dlx/yarn dlx, but using
 * our own cache directory (~/.socket/_dlx) and installation logic.
 *
 * Auto-forces reinstall for version ranges to get latest within range.
 *
 * @example
 * ```typescript
 * // Download and execute cdxgen
 * const result = await dlxPackage(
 *   ['--version'],
 *   { package: '@cyclonedx/cdxgen@10.0.0' }
 * )
 * await result.spawnPromise
 * ```
 */
export async function dlxPackage(
  args: readonly string[] | string[],
  options?: DlxPackageOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxPackageResult> {
  // Download the package.
  const downloadResult = await downloadPackage(options!)

  // Execute the binary.
  const spawnPromise = executePackage(
    downloadResult.binaryPath,
    args,
    options?.spawnOptions,
    spawnExtra,
  )

  return {
    ...downloadResult,
    spawnPromise,
  }
}

/**
 * Make all binaries in an installed package executable.
 * Reads the package.json bin field and makes all binaries executable (chmod 0o755).
 * Handles both single binary (string) and multiple binaries (object) formats.
 *
 * Aligns with npm's approach:
 * - Uses 0o755 permission (matches npm's cmd-shim)
 * - Reads bin field from package.json (matches npm's bin-links and libnpmexec)
 * - Handles both string and object bin formats
 *
 * References:
 * - npm cmd-shim: https://github.com/npm/cmd-shim/blob/main/lib/index.js
 * - npm getBinFromManifest: https://github.com/npm/libnpmexec/blob/main/lib/get-bin-from-manifest.js
 */
function makePackageBinsExecutable(
  packageDir: string,
  packageName: string,
): void {
  if (WIN32) {
    // Windows doesn't need chmod
    return
  }

  const fs = getFs()
  const installedDir = normalizePath(
    path.join(packageDir, 'node_modules', packageName),
  )
  const pkgJsonPath = path.join(installedDir, 'package.json')

  try {
    const pkgJson = readJsonSync(pkgJsonPath) as Record<string, unknown>
    const bin = pkgJson['bin']

    if (!bin) {
      return
    }

    const binPaths: string[] = []

    if (typeof bin === 'string') {
      // Single binary
      binPaths.push(bin)
    } else if (typeof bin === 'object' && bin !== null) {
      // Multiple binaries
      const binObj = bin as Record<string, string>
      binPaths.push(...Object.values(binObj))
    }

    // Make all binaries executable
    for (const binPath of binPaths) {
      const fullPath = normalizePath(path.join(installedDir, binPath))
      if (fs.existsSync(fullPath)) {
        try {
          fs.chmodSync(fullPath, 0o755)
        } catch {
          // Ignore chmod errors on individual binaries
        }
      }
    }
  } catch {
    // Ignore errors reading package.json or making binaries executable
    // This is non-critical functionality
  }
}

/**
 * Download and install a package without executing it.
 * This is useful for self-update or when you need the package files
 * but don't want to run the binary immediately.
 *
 * @example
 * ```typescript
 * // Install @socketsecurity/cli without running it
 * const result = await downloadPackage({
 *   package: '@socketsecurity/cli@1.2.0',
 *   force: true
 * })
 * console.log('Installed to:', result.packageDir)
 * console.log('Binary at:', result.binaryPath)
 * ```
 */
export async function downloadPackage(
  options: DlxPackageOptions,
): Promise<DownloadPackageResult> {
  const {
    binaryName,
    force: userForce,
    package: packageSpec,
    yes,
  } = {
    __proto__: null,
    ...options,
  } as DlxPackageOptions

  // Parse package spec.
  const { name: packageName, version: packageVersion } =
    parsePackageSpec(packageSpec)

  // Determine force behavior:
  // 1. Explicit force takes precedence
  // 2. --yes flag implies force (auto-approve/skip prompts)
  // 3. Version ranges auto-force to get latest
  const isVersionRange =
    packageVersion !== undefined && rangeOperatorsRegExp.test(packageVersion)
  const force =
    userForce !== undefined ? userForce : yes === true ? true : isVersionRange

  // Build full package spec for installation.
  const fullPackageSpec = packageVersion
    ? `${packageName}@${packageVersion}`
    : packageName

  // Ensure package is installed.
  const { installed, packageDir } = await ensurePackageInstalled(
    packageName,
    fullPackageSpec,
    force,
  )

  // Find binary path.
  const binaryPath = findBinaryPath(packageDir, packageName, binaryName)

  // Make all binaries in the package executable on Unix systems.
  makePackageBinsExecutable(packageDir, packageName)

  return {
    binaryPath,
    installed,
    packageDir,
  }
}

/**
 * Execute a package's binary with cross-platform shell handling.
 * The package must already be installed (use downloadPackage first).
 *
 * On Windows, script files (.bat, .cmd, .ps1) require shell: true.
 * Matches npm/npx execution behavior.
 *
 * @example
 * ```typescript
 * // Execute an already-installed package
 * const downloaded = await downloadPackage({ package: 'cowsay@1.5.0' })
 * const result = await executePackage(
 *   downloaded.binaryPath,
 *   ['Hello World'],
 *   { stdio: 'inherit' }
 * )
 * ```
 */
export function executePackage(
  binaryPath: string,
  args: readonly string[] | string[],
  spawnOptions?: SpawnOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): ReturnType<typeof spawn> {
  // On Windows, script files (.bat, .cmd, .ps1) require shell: true
  // because they are not executable on their own and must be run through cmd.exe.
  // .exe files are actual binaries and don't need shell mode.
  const needsShell = WIN32 && /\.(?:bat|cmd|ps1)$/i.test(binaryPath)

  const finalOptions = needsShell
    ? {
        ...spawnOptions,
        shell: true,
      }
    : spawnOptions

  return spawn(binaryPath, args, finalOptions, spawnExtra)
}
