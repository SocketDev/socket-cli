import path from 'path'

import { WIN32 } from '#constants/platform'
import { debugNs } from './debug'
import { getGlobMatcher } from './globs'
import { normalizePath } from './path'
import { spawn, spawnSync } from './spawn'
import { stripAnsi } from './strings'

/**
 * Options for git diff operations.
 *
 * Controls how git diff results are processed and returned.
 *
 * @example
 * ```typescript
 * // Get absolute file paths
 * const files = await getChangedFiles({ absolute: true })
 * // => ['/path/to/repo/src/file.ts']
 *
 * // Get relative paths with caching disabled
 * const files = await getChangedFiles({ cache: false })
 * // => ['src/file.ts']
 *
 * // Get files from specific directory
 * const files = await getChangedFiles({ cwd: '/path/to/repo/src' })
 * ```
 */
export interface GitDiffOptions {
  /**
   * Return absolute file paths instead of relative paths.
   *
   * @default false
   */
  absolute?: boolean | undefined
  /**
   * Cache git diff results to avoid repeated git subprocess calls.
   *
   * Caching is keyed by the git command and options used, so different
   * option combinations maintain separate cache entries.
   *
   * @default true
   */
  cache?: boolean | undefined
  /**
   * Working directory for git operations.
   *
   * Git operations will be run from this directory, and returned paths
   * will be relative to the git repository root. Symlinks are resolved
   * using `fs.realpathSync()`.
   *
   * @default process.cwd()
   */
  cwd?: string | undefined
  /**
   * Parse git porcelain format output (status codes like `M`, `A`, `??`).
   *
   * When `true`, strips the two-character status code and space from the
   * beginning of each line. Automatically enabled for `getChangedFiles()`.
   *
   * @default false
   */
  porcelain?: boolean | undefined
  /**
   * Return results as a `Set` instead of an array.
   *
   * @default false
   */
  asSet?: boolean | undefined
  /**
   * Additional options passed to glob matcher.
   *
   * Supports options like `dot`, `ignore`, `nocase` for filtering results.
   */
  [key: string]: unknown
}

/**
 * Options for filtering packages by git changes.
 *
 * Used to determine which packages in a monorepo have changed files.
 *
 * @example
 * ```typescript
 * // Filter packages with changes
 * const changed = filterPackagesByChanges(packages)
 *
 * // Force include all packages
 * const all = filterPackagesByChanges(packages, { force: true })
 *
 * // Use custom package key
 * const changed = filterPackagesByChanges(
 *   packages,
 *   { packageKey: 'directory' }
 * )
 * ```
 */
export interface FilterPackagesByChangesOptions {
  /**
   * Force include all packages regardless of changes.
   *
   * @default false
   */
  force?: boolean | undefined
  /**
   * Key to access package path in package objects.
   *
   * @default 'path'
   */
  packageKey?: string | undefined
  /**
   * Additional options for filtering.
   */
  [key: string]: unknown
}

type SpawnArgs = [string, string[], Record<string, unknown>]

interface GitDiffSpawnArgs {
  all: SpawnArgs
  unstaged: SpawnArgs
  staged: SpawnArgs
}

const gitDiffCache = new Map<string, string[]>()

let _fs: typeof import('fs') | undefined
/**
 * Lazily load the `fs` module to avoid Webpack errors.
 *
 * Uses non-`node:` prefixed require internally to prevent Webpack from
 * attempting to bundle Node.js built-in modules.
 *
 * @returns The Node.js `fs` module.
 *
 * @example
 * ```typescript
 * const fs = getFs()
 * const exists = fs.existsSync('/path/to/file')
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function getFs() {
  if (_fs === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _fs = /*@__PURE__*/ require('node:fs')
  }
  return _fs as typeof import('fs')
}

let _path: typeof import('path') | undefined
/**
 * Lazily load the `path` module to avoid Webpack errors.
 *
 * Uses non-`node:` prefixed require internally to prevent Webpack from
 * attempting to bundle Node.js built-in modules.
 *
 * @returns The Node.js `path` module.
 *
 * @example
 * ```typescript
 * const path = getPath()
 * const joined = path.join('/foo', 'bar')
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('path')
}

/**
 * Get the git executable path.
 *
 * Currently always returns `'git'`, relying on the system PATH to resolve
 * the git binary location. This may be extended in the future to support
 * custom git paths.
 *
 * @returns The git executable name or path.
 *
 * @example
 * ```typescript
 * const git = getGitPath()
 * // => 'git'
 * ```
 */
function getGitPath(): string {
  return 'git'
}

/**
 * Get the current working directory for git operations.
 *
 * Returns the real path to handle symlinks correctly. This is important
 * because symlinked directories like `/tmp -> /private/tmp` can cause
 * path mismatches when comparing git output.
 *
 * @returns The resolved real path of `process.cwd()`.
 *
 * @example
 * ```typescript
 * const cwd = getCwd()
 * // In /tmp (symlink to /private/tmp):
 * // => '/private/tmp'
 * ```
 */
function getCwd(): string {
  return getFs().realpathSync(process.cwd())
}

/**
 * Get spawn arguments for different git diff operations.
 *
 * Prepares argument arrays for `spawn()`/`spawnSync()` calls that retrieve:
 * - `all`: All changed files (staged, unstaged, untracked) via `git status --porcelain`
 * - `unstaged`: Unstaged modifications via `git diff --name-only`
 * - `staged`: Staged changes via `git diff --cached --name-only`
 *
 * Automatically resolves symlinks in the provided `cwd` and enables shell
 * mode on Windows for proper command execution.
 *
 * @param cwd - Working directory for git operations, defaults to `process.cwd()`.
 * @returns Object containing spawn arguments for all, unstaged, and staged operations.
 */
function getGitDiffSpawnArgs(cwd?: string | undefined): GitDiffSpawnArgs {
  const resolvedCwd = cwd ? getFs().realpathSync(cwd) : getCwd()
  return {
    all: [
      getGitPath(),
      ['status', '--porcelain'],
      {
        cwd: resolvedCwd,
        shell: WIN32,
      },
    ],
    unstaged: [
      getGitPath(),
      ['diff', '--name-only'],
      {
        cwd: resolvedCwd,
      },
    ],
    staged: [
      getGitPath(),
      ['diff', '--cached', '--name-only'],
      {
        cwd: resolvedCwd,
        shell: WIN32,
      },
    ],
  }
}

/**
 * Execute git diff command asynchronously and parse results.
 *
 * Internal helper for async git operations. Handles caching, command execution,
 * and result parsing. Returns empty array on git command failure.
 *
 * @param args - Spawn arguments tuple `[command, args, options]`.
 * @param options - Git diff options for caching and parsing.
 * @returns Promise resolving to array of file paths.
 */
async function innerDiff(
  args: SpawnArgs,
  options?: GitDiffOptions | undefined,
): Promise<string[]> {
  const { cache = true, ...parseOptions } = { __proto__: null, ...options }
  const cacheKey = cache ? JSON.stringify({ args, parseOptions }) : undefined
  if (cache && cacheKey) {
    const result = gitDiffCache.get(cacheKey)
    if (result) {
      return result
    }
  }
  let result: string[]
  try {
    // Use stdioString: false to get raw Buffer, then convert ourselves to preserve exact output.
    const spawnResult = await spawn(args[0], args[1], {
      ...args[2],
      stdioString: false,
    })
    const stdout = Buffer.isBuffer(spawnResult.stdout)
      ? spawnResult.stdout.toString('utf8')
      : String(spawnResult.stdout)
    // Extract spawn cwd from args to pass to parser
    const spawnCwd =
      typeof args[2]['cwd'] === 'string' ? args[2]['cwd'] : undefined
    result = parseGitDiffStdout(stdout, parseOptions, spawnCwd)
  } catch (e) {
    // Git command failed. This is expected if:
    // - Not in a git repository
    // - Git is not installed
    // - Permission issues accessing .git directory
    // Log warning in debug mode for troubleshooting.
    debugNs(
      'git',
      `Git command failed (${args[0]} ${args[1].join(' ')}): ${(e as Error).message}`,
    )
    return []
  }
  if (cache && cacheKey) {
    gitDiffCache.set(cacheKey, result)
  }
  return result
}

/**
 * Execute git diff command synchronously and parse results.
 *
 * Internal helper for sync git operations. Handles caching, command execution,
 * and result parsing. Returns empty array on git command failure.
 *
 * @param args - Spawn arguments tuple `[command, args, options]`.
 * @param options - Git diff options for caching and parsing.
 * @returns Array of file paths.
 */
function innerDiffSync(
  args: SpawnArgs,
  options?: GitDiffOptions | undefined,
): string[] {
  const { cache = true, ...parseOptions } = { __proto__: null, ...options }
  const cacheKey = cache ? JSON.stringify({ args, parseOptions }) : undefined
  if (cache && cacheKey) {
    const result = gitDiffCache.get(cacheKey)
    if (result) {
      return result
    }
  }
  let result: string[]
  try {
    // Use stdioString: false to get raw Buffer, then convert ourselves to preserve exact output.
    const spawnResult = spawnSync(args[0], args[1], {
      ...args[2],
      stdioString: false,
    })
    const stdout = Buffer.isBuffer(spawnResult.stdout)
      ? spawnResult.stdout.toString('utf8')
      : String(spawnResult.stdout)
    // Extract spawn cwd from args to pass to parser
    const spawnCwd =
      typeof args[2]['cwd'] === 'string' ? args[2]['cwd'] : undefined
    result = parseGitDiffStdout(stdout, parseOptions, spawnCwd)
  } catch (e) {
    // Git command failed. This is expected if:
    // - Not in a git repository
    // - Git is not installed
    // - Permission issues accessing .git directory
    // Log warning in debug mode for troubleshooting.
    debugNs(
      'git',
      `Git command failed (${args[0]} ${args[1].join(' ')}): ${(e as Error).message}`,
    )
    return []
  }
  if (cache && cacheKey) {
    gitDiffCache.set(cacheKey, result)
  }
  return result
}

/**
 * Find git repository root by walking up from the given directory.
 *
 * Searches for a `.git` directory or file by traversing parent directories
 * upward until found or filesystem root is reached. Returns the original path
 * if no git repository is found.
 *
 * This function is exported primarily for testing purposes.
 *
 * @param startPath - Directory path to start searching from.
 * @returns Git repository root path, or `startPath` if not found.
 *
 * @example
 * ```typescript
 * const root = findGitRoot('/path/to/repo/src/subdir')
 * // => '/path/to/repo'
 *
 * const notFound = findGitRoot('/not/a/repo')
 * // => '/not/a/repo'
 * ```
 */
export function findGitRoot(startPath: string): string {
  const fs = getFs()
  const path = getPath()
  let currentPath = startPath
  // Walk up the directory tree looking for .git
  while (true) {
    try {
      const gitPath = path.join(currentPath, '.git')
      if (fs.existsSync(gitPath)) {
        return currentPath
      }
    } catch {
      // Ignore errors and continue walking up
    }
    const parentPath = path.dirname(currentPath)
    // Stop if we've reached the root or can't go up anymore
    if (parentPath === currentPath) {
      // Return original path if no .git found
      return startPath
    }
    currentPath = parentPath
  }
}

/**
 * Parse git diff stdout output into file path array.
 *
 * Internal helper that processes raw git command output by:
 * 1. Finding git repository root from spawn cwd
 * 2. Stripping ANSI codes and splitting into lines
 * 3. Parsing porcelain format status codes if requested
 * 4. Normalizing and optionally making paths absolute
 * 5. Filtering paths based on cwd and glob options
 *
 * Git always returns paths relative to the repository root, regardless of
 * where the command was executed. This function handles the path resolution
 * correctly by finding the repo root and adjusting paths accordingly.
 *
 * @param stdout - Raw stdout from git command.
 * @param options - Git diff options for path processing.
 * @param spawnCwd - Working directory where git command was executed.
 * @returns Array of processed file paths.
 */
function parseGitDiffStdout(
  stdout: string,
  options?: GitDiffOptions | undefined,
  spawnCwd?: string | undefined,
): string[] {
  // Find git repo root from spawnCwd. Git always returns paths relative to the repo root,
  // not the cwd where it was run. So we need to find the repo root to correctly parse paths.
  const defaultRoot = spawnCwd ? findGitRoot(spawnCwd) : getCwd()
  const {
    absolute = false,
    cwd: cwdOption = defaultRoot,
    porcelain = false,
    ...matcherOptions
  } = { __proto__: null, ...options }
  // Resolve cwd to handle symlinks.
  const cwd =
    cwdOption === defaultRoot ? defaultRoot : getFs().realpathSync(cwdOption)
  const rootPath = defaultRoot
  // Split into lines without trimming to preserve leading spaces in porcelain format.
  let rawFiles = stdout
    ? stripAnsi(stdout)
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line)
    : []
  // Parse porcelain format: strip status codes.
  // Git status --porcelain format is: XY filename
  // where X and Y are single characters and there's a space before the filename.
  if (porcelain) {
    rawFiles = rawFiles.map(line => {
      // Status is first 2 chars, then space, then filename.
      return line.length > 3 ? line.substring(3) : line
    })
  }
  const files = absolute
    ? rawFiles.map(relPath => normalizePath(path.join(rootPath, relPath)))
    : rawFiles.map(relPath => normalizePath(relPath))
  if (cwd === rootPath) {
    return files
  }
  const relPath = normalizePath(path.relative(rootPath, cwd))
  const matcher = getGlobMatcher([`${relPath}/**`], {
    ...(matcherOptions as {
      dot?: boolean
      ignore?: string[]
      nocase?: boolean
    }),
    absolute,
    cwd: rootPath,
  } as {
    absolute?: boolean
    cwd?: string
    dot?: boolean
    ignore?: string[]
    nocase?: boolean
  })
  const filtered: string[] = []
  for (const filepath of files) {
    if (matcher(filepath)) {
      filtered.push(filepath)
    }
  }
  return filtered
}

/**
 * Get all changed files including staged, unstaged, and untracked files.
 *
 * Uses `git status --porcelain` which returns the full working tree status
 * with status codes:
 * - `M` - Modified
 * - `A` - Added
 * - `D` - Deleted
 * - `??` - Untracked
 * - `R` - Renamed
 * - `C` - Copied
 *
 * This is the most comprehensive check - captures everything that differs
 * from the last commit, including:
 * - Files modified and staged with `git add`
 * - Files modified but not staged
 * - New files not yet tracked by git
 *
 * Status codes are automatically stripped from the output.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Promise resolving to array of changed file paths.
 *
 * @example
 * ```typescript
 * // Get all changed files as relative paths
 * const files = await getChangedFiles()
 * // => ['src/foo.ts', 'src/bar.ts', 'newfile.ts']
 *
 * // Get absolute paths
 * const files = await getChangedFiles({ absolute: true })
 * // => ['/path/to/repo/src/foo.ts', ...]
 *
 * // Get changed files in specific directory
 * const files = await getChangedFiles({ cwd: '/path/to/repo/src' })
 * // => ['foo.ts', 'bar.ts']
 * ```
 */
export async function getChangedFiles(
  options?: GitDiffOptions | undefined,
): Promise<string[]> {
  const args = getGitDiffSpawnArgs(options?.cwd).all
  return await innerDiff(args, {
    __proto__: null,
    ...options,
    porcelain: true,
  })
}

/**
 * Get all changed files including staged, unstaged, and untracked files.
 *
 * Synchronous version of `getChangedFiles()`. Uses `git status --porcelain`
 * which returns the full working tree status with status codes:
 * - `M` - Modified
 * - `A` - Added
 * - `D` - Deleted
 * - `??` - Untracked
 * - `R` - Renamed
 * - `C` - Copied
 *
 * This is the most comprehensive check - captures everything that differs
 * from the last commit, including:
 * - Files modified and staged with `git add`
 * - Files modified but not staged
 * - New files not yet tracked by git
 *
 * Status codes are automatically stripped from the output.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Array of changed file paths.
 *
 * @example
 * ```typescript
 * // Get all changed files as relative paths
 * const files = getChangedFilesSync()
 * // => ['src/foo.ts', 'src/bar.ts', 'newfile.ts']
 *
 * // Get absolute paths
 * const files = getChangedFilesSync({ absolute: true })
 * // => ['/path/to/repo/src/foo.ts', ...]
 *
 * // Get changed files in specific directory
 * const files = getChangedFilesSync({ cwd: '/path/to/repo/src' })
 * // => ['foo.ts', 'bar.ts']
 * ```
 */
export function getChangedFilesSync(
  options?: GitDiffOptions | undefined,
): string[] {
  const args = getGitDiffSpawnArgs(options?.cwd).all
  return innerDiffSync(args, {
    __proto__: null,
    ...options,
    porcelain: true,
  })
}

/**
 * Get unstaged modified files (changes not yet staged for commit).
 *
 * Uses `git diff --name-only` which returns only unstaged modifications
 * to tracked files. Does NOT include:
 * - Untracked files (new files not added to git)
 * - Staged changes (files added with `git add`)
 *
 * This is a focused check for uncommitted changes to existing tracked files.
 * Useful for detecting work-in-progress modifications before staging.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Promise resolving to array of unstaged file paths.
 *
 * @example
 * ```typescript
 * // Get unstaged files
 * const files = await getUnstagedFiles()
 * // => ['src/foo.ts', 'src/bar.ts']
 *
 * // After staging some files
 * await spawn('git', ['add', 'src/foo.ts'])
 * const files = await getUnstagedFiles()
 * // => ['src/bar.ts'] (foo.ts no longer included)
 *
 * // Get absolute paths
 * const files = await getUnstagedFiles({ absolute: true })
 * // => ['/path/to/repo/src/bar.ts']
 * ```
 */
export async function getUnstagedFiles(
  options?: GitDiffOptions | undefined,
): Promise<string[]> {
  const args = getGitDiffSpawnArgs(options?.cwd).unstaged
  return await innerDiff(args, options)
}

/**
 * Get unstaged modified files (changes not yet staged for commit).
 *
 * Synchronous version of `getUnstagedFiles()`. Uses `git diff --name-only`
 * which returns only unstaged modifications to tracked files. Does NOT include:
 * - Untracked files (new files not added to git)
 * - Staged changes (files added with `git add`)
 *
 * This is a focused check for uncommitted changes to existing tracked files.
 * Useful for detecting work-in-progress modifications before staging.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Array of unstaged file paths.
 *
 * @example
 * ```typescript
 * // Get unstaged files
 * const files = getUnstagedFilesSync()
 * // => ['src/foo.ts', 'src/bar.ts']
 *
 * // After staging some files
 * spawnSync('git', ['add', 'src/foo.ts'])
 * const files = getUnstagedFilesSync()
 * // => ['src/bar.ts'] (foo.ts no longer included)
 *
 * // Get absolute paths
 * const files = getUnstagedFilesSync({ absolute: true })
 * // => ['/path/to/repo/src/bar.ts']
 * ```
 */
export function getUnstagedFilesSync(
  options?: GitDiffOptions | undefined,
): string[] {
  const args = getGitDiffSpawnArgs(options?.cwd).unstaged
  return innerDiffSync(args, options)
}

/**
 * Get staged files ready for commit (changes added with `git add`).
 *
 * Uses `git diff --cached --name-only` which returns only staged changes.
 * Does NOT include:
 * - Unstaged modifications (changes not added with `git add`)
 * - Untracked files (new files not added to git)
 *
 * This is a focused check for what will be included in the next commit.
 * Useful for validating changes before committing or running pre-commit hooks.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Promise resolving to array of staged file paths.
 *
 * @example
 * ```typescript
 * // Get currently staged files
 * const files = await getStagedFiles()
 * // => ['src/foo.ts']
 *
 * // Stage more files
 * await spawn('git', ['add', 'src/bar.ts'])
 * const files = await getStagedFiles()
 * // => ['src/foo.ts', 'src/bar.ts']
 *
 * // Get absolute paths
 * const files = await getStagedFiles({ absolute: true })
 * // => ['/path/to/repo/src/foo.ts', ...]
 * ```
 */
export async function getStagedFiles(
  options?: GitDiffOptions | undefined,
): Promise<string[]> {
  const args = getGitDiffSpawnArgs(options?.cwd).staged
  return await innerDiff(args, options)
}

/**
 * Get staged files ready for commit (changes added with `git add`).
 *
 * Synchronous version of `getStagedFiles()`. Uses `git diff --cached --name-only`
 * which returns only staged changes. Does NOT include:
 * - Unstaged modifications (changes not added with `git add`)
 * - Untracked files (new files not added to git)
 *
 * This is a focused check for what will be included in the next commit.
 * Useful for validating changes before committing or running pre-commit hooks.
 *
 * @param options - Options controlling path format and filtering.
 * @returns Array of staged file paths.
 *
 * @example
 * ```typescript
 * // Get currently staged files
 * const files = getStagedFilesSync()
 * // => ['src/foo.ts']
 *
 * // Stage more files
 * spawnSync('git', ['add', 'src/bar.ts'])
 * const files = getStagedFilesSync()
 * // => ['src/foo.ts', 'src/bar.ts']
 *
 * // Get absolute paths
 * const files = getStagedFilesSync({ absolute: true })
 * // => ['/path/to/repo/src/foo.ts', ...]
 * ```
 */
export function getStagedFilesSync(
  options?: GitDiffOptions | undefined,
): string[] {
  const args = getGitDiffSpawnArgs(options?.cwd).staged
  return innerDiffSync(args, options)
}

/**
 * Check if a file or directory has any git changes.
 *
 * Checks if the given pathname has any changes including:
 * - Staged modifications (added with `git add`)
 * - Unstaged modifications (not yet staged)
 * - Untracked status (new file/directory not in git)
 *
 * For directories, returns `true` if ANY file within the directory has changes.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git status check.
 * @returns Promise resolving to `true` if path has any changes, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file is changed
 * const changed = await isChanged('src/foo.ts')
 * // => true
 *
 * // Check if directory has any changes
 * const changed = await isChanged('src/')
 * // => true (if any file in src/ is changed)
 *
 * // Check from different cwd
 * const changed = await isChanged(
 *   '/path/to/repo/src/foo.ts',
 *   { cwd: '/path/to/repo' }
 * )
 * ```
 */
export async function isChanged(
  pathname: string,
  options?: GitDiffOptions | undefined,
): Promise<boolean> {
  const files = await getChangedFiles({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}

/**
 * Check if a file or directory has any git changes.
 *
 * Synchronous version of `isChanged()`. Checks if the given pathname has
 * any changes including:
 * - Staged modifications (added with `git add`)
 * - Unstaged modifications (not yet staged)
 * - Untracked status (new file/directory not in git)
 *
 * For directories, returns `true` if ANY file within the directory has changes.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git status check.
 * @returns `true` if path has any changes, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file is changed
 * const changed = isChangedSync('src/foo.ts')
 * // => true
 *
 * // Check if directory has any changes
 * const changed = isChangedSync('src/')
 * // => true (if any file in src/ is changed)
 *
 * // Check from different cwd
 * const changed = isChangedSync(
 *   '/path/to/repo/src/foo.ts',
 *   { cwd: '/path/to/repo' }
 * )
 * ```
 */
export function isChangedSync(
  pathname: string,
  options?: GitDiffOptions | undefined,
): boolean {
  const files = getChangedFilesSync({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}

/**
 * Check if a file or directory has unstaged changes.
 *
 * Checks if the given pathname has modifications that are not yet staged
 * for commit (changes not added with `git add`). Does NOT include:
 * - Staged changes (already added with `git add`)
 * - Untracked files (new files not in git)
 *
 * For directories, returns `true` if ANY file within the directory has
 * unstaged changes.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git diff check.
 * @returns Promise resolving to `true` if path has unstaged changes, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file has unstaged changes
 * const unstaged = await isUnstaged('src/foo.ts')
 * // => true
 *
 * // After staging the file
 * await spawn('git', ['add', 'src/foo.ts'])
 * const unstaged = await isUnstaged('src/foo.ts')
 * // => false
 *
 * // Check directory
 * const unstaged = await isUnstaged('src/')
 * // => true (if any file in src/ has unstaged changes)
 * ```
 */
export async function isUnstaged(
  pathname: string,
  options?: GitDiffOptions | undefined,
): Promise<boolean> {
  const files = await getUnstagedFiles({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}

/**
 * Check if a file or directory has unstaged changes.
 *
 * Synchronous version of `isUnstaged()`. Checks if the given pathname has
 * modifications that are not yet staged for commit (changes not added with
 * `git add`). Does NOT include:
 * - Staged changes (already added with `git add`)
 * - Untracked files (new files not in git)
 *
 * For directories, returns `true` if ANY file within the directory has
 * unstaged changes.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git diff check.
 * @returns `true` if path has unstaged changes, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file has unstaged changes
 * const unstaged = isUnstagedSync('src/foo.ts')
 * // => true
 *
 * // After staging the file
 * spawnSync('git', ['add', 'src/foo.ts'])
 * const unstaged = isUnstagedSync('src/foo.ts')
 * // => false
 *
 * // Check directory
 * const unstaged = isUnstagedSync('src/')
 * // => true (if any file in src/ has unstaged changes)
 * ```
 */
export function isUnstagedSync(
  pathname: string,
  options?: GitDiffOptions | undefined,
): boolean {
  const files = getUnstagedFilesSync({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}

/**
 * Check if a file or directory is staged for commit.
 *
 * Checks if the given pathname has changes staged with `git add` that will
 * be included in the next commit. Does NOT include:
 * - Unstaged modifications (changes not added with `git add`)
 * - Untracked files (new files not in git)
 *
 * For directories, returns `true` if ANY file within the directory is staged.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git diff check.
 * @returns Promise resolving to `true` if path is staged, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file is staged
 * const staged = await isStaged('src/foo.ts')
 * // => false
 *
 * // Stage the file
 * await spawn('git', ['add', 'src/foo.ts'])
 * const staged = await isStaged('src/foo.ts')
 * // => true
 *
 * // Check directory
 * const staged = await isStaged('src/')
 * // => true (if any file in src/ is staged)
 * ```
 */
export async function isStaged(
  pathname: string,
  options?: GitDiffOptions | undefined,
): Promise<boolean> {
  const files = await getStagedFiles({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}

/**
 * Check if a file or directory is staged for commit.
 *
 * Synchronous version of `isStaged()`. Checks if the given pathname has
 * changes staged with `git add` that will be included in the next commit.
 * Does NOT include:
 * - Unstaged modifications (changes not added with `git add`)
 * - Untracked files (new files not in git)
 *
 * For directories, returns `true` if ANY file within the directory is staged.
 *
 * Symlinks in the pathname and cwd are automatically resolved using
 * `fs.realpathSync()` before comparison.
 *
 * @param pathname - File or directory path to check.
 * @param options - Options for the git diff check.
 * @returns `true` if path is staged, `false` otherwise.
 *
 * @example
 * ```typescript
 * // Check if file is staged
 * const staged = isStagedSync('src/foo.ts')
 * // => false
 *
 * // Stage the file
 * spawnSync('git', ['add', 'src/foo.ts'])
 * const staged = isStagedSync('src/foo.ts')
 * // => true
 *
 * // Check directory
 * const staged = isStagedSync('src/')
 * // => true (if any file in src/ is staged)
 * ```
 */
export function isStagedSync(
  pathname: string,
  options?: GitDiffOptions | undefined,
): boolean {
  const files = getStagedFilesSync({
    __proto__: null,
    ...options,
    absolute: false,
  })
  // Resolve pathname to handle symlinks before computing relative path.
  const resolvedPathname = getFs().realpathSync(pathname)
  const baseCwd = options?.cwd ? getFs().realpathSync(options['cwd']) : getCwd()
  const relativePath = normalizePath(path.relative(baseCwd, resolvedPathname))
  return files.includes(relativePath)
}
