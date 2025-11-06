/**
 * @fileoverview File system utilities with cross-platform path handling.
 * Provides enhanced fs operations, glob matching, and directory traversal functions.
 */

import type { Abortable } from 'events'

import type {
  Dirent,
  MakeDirectoryOptions,
  ObjectEncodingOptions,
  OpenMode,
  PathLike,
  StatSyncOptions,
  WriteFileOptions,
} from 'fs'

import { getAbortSignal } from '#constants/process'

import { isArray } from './arrays'

const abortSignal = getAbortSignal()

import { defaultIgnore, getGlobMatcher } from './globs'
import type { JsonReviver } from './json'
import { jsonParse } from './json'
import { objectFreeze, type Remap } from './objects'
import { normalizePath, pathLikeToString } from './path'
import { registerCacheInvalidation } from './paths/rewire'
import { naturalCompare } from './sorts'

/**
 * Supported text encodings for Node.js Buffers.
 * Includes ASCII, UTF-8/16, base64, binary, and hexadecimal encodings.
 */
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex'

/**
 * Represents any valid JSON content type.
 */
export type JsonContent = unknown

/**
 * Options for asynchronous `findUp` operations.
 */
export interface FindUpOptions {
  /**
   * Starting directory for the search.
   * @default process.cwd()
   */
  cwd?: string | undefined
  /**
   * Only match directories, not files.
   * @default false
   */
  onlyDirectories?: boolean | undefined
  /**
   * Only match files, not directories.
   * @default true
   */
  onlyFiles?: boolean | undefined
  /**
   * Abort signal to cancel the search operation.
   */
  signal?: AbortSignal | undefined
}

/**
 * Options for synchronous `findUpSync` operations.
 */
export interface FindUpSyncOptions {
  /**
   * Starting directory for the search.
   * @default process.cwd()
   */
  cwd?: string | undefined
  /**
   * Directory to stop searching at (inclusive).
   * When provided, search will stop at this directory even if the root hasn't been reached.
   */
  stopAt?: string | undefined
  /**
   * Only match directories, not files.
   * @default false
   */
  onlyDirectories?: boolean | undefined
  /**
   * Only match files, not directories.
   * @default true
   */
  onlyFiles?: boolean | undefined
}

/**
 * Options for checking if a directory is empty.
 */
export interface IsDirEmptyOptions {
  /**
   * Glob patterns for files to ignore when checking emptiness.
   * Files matching these patterns are not counted.
   * @default defaultIgnore
   */
  ignore?: string[] | readonly string[] | undefined
}

/**
 * Options for read operations with abort support.
 */
export interface ReadOptions extends Abortable {
  /**
   * Character encoding to use for reading.
   * @default 'utf8'
   */
  encoding?: BufferEncoding | string | undefined
  /**
   * File system flag for reading behavior.
   * @default 'r'
   */
  flag?: string | undefined
}

/**
 * Options for reading directories with filtering and sorting.
 */
export interface ReadDirOptions {
  /**
   * Glob patterns for directories to ignore.
   * @default undefined
   */
  ignore?: string[] | readonly string[] | undefined
  /**
   * Include empty directories in results.
   * When `false`, empty directories are filtered out.
   * @default true
   */
  includeEmpty?: boolean | undefined
  /**
   * Sort directory names alphabetically using natural sort order.
   * @default true
   */
  sort?: boolean | undefined
}

/**
 * Options for reading files with encoding and abort support.
 * Can be either an options object, an encoding string, or null.
 */
export type ReadFileOptions =
  | Remap<
      ObjectEncodingOptions &
        Abortable & {
          flag?: OpenMode | undefined
        }
    >
  | BufferEncoding
  | null

/**
 * Options for reading and parsing JSON files.
 */
export type ReadJsonOptions = Remap<
  ReadFileOptions & {
    /**
     * Whether to throw errors on parse failure.
     * When `false`, returns `undefined` on error instead of throwing.
     * @default true
     */
    throws?: boolean | undefined
    /**
     * JSON reviver function to transform parsed values.
     * Same as the second parameter to `JSON.parse()`.
     */
    reviver?: Parameters<typeof JSON.parse>[1] | undefined
  }
>

/**
 * Options for file/directory removal operations.
 */
export interface RemoveOptions {
  /**
   * Force deletion even outside normally safe directories.
   * When `false`, prevents deletion outside temp, cacache, and ~/.socket.
   * @default true for safe directories, false otherwise
   */
  force?: boolean | undefined
  /**
   * Maximum number of retry attempts on failure.
   * @default 3
   */
  maxRetries?: number | undefined
  /**
   * Recursively delete directories and contents.
   * @default true
   */
  recursive?: boolean | undefined
  /**
   * Delay in milliseconds between retry attempts.
   * @default 200
   */
  retryDelay?: number | undefined
  /**
   * Abort signal to cancel the operation.
   */
  signal?: AbortSignal | undefined
}

/**
 * Options for safe read operations that don't throw on errors.
 */
export interface SafeReadOptions extends ReadOptions {
  /**
   * Default value to return on read failure.
   * If not provided, `undefined` is returned on error.
   */
  defaultValue?: unknown | undefined
}

/**
 * Options for write operations with encoding and mode control.
 */
export interface WriteOptions extends Abortable {
  /**
   * Character encoding for writing.
   * @default 'utf8'
   */
  encoding?: BufferEncoding | string | undefined
  /**
   * File mode (permissions) to set.
   * Uses standard Unix permission bits (e.g., 0o644).
   * @default 0o666 (read/write for all, respecting umask)
   */
  mode?: number | undefined
  /**
   * File system flag for write behavior.
   * @default 'w' (create or truncate)
   */
  flag?: string | undefined
}

/**
 * Options for writing JSON files with formatting control.
 */
export interface WriteJsonOptions extends WriteOptions {
  /**
   * End-of-line sequence to use.
   * @default '\n'
   * @example
   * ```ts
   * // Windows-style line endings
   * writeJson('data.json', data, { EOL: '\r\n' })
   * ```
   */
  EOL?: string | undefined
  /**
   * Whether to add a final newline at end of file.
   * @default true
   */
  finalEOL?: boolean | undefined
  /**
   * JSON replacer function to transform values during stringification.
   * Same as the second parameter to `JSON.stringify()`.
   */
  replacer?: JsonReviver | undefined
  /**
   * Number of spaces for indentation, or string to use for indentation.
   * @default 2
   * @example
   * ```ts
   * // Use tabs instead of spaces
   * writeJson('data.json', data, { spaces: '\t' })
   *
   * // Use 4 spaces for indentation
   * writeJson('data.json', data, { spaces: 4 })
   * ```
   */
  spaces?: number | string | undefined
}

const defaultRemoveOptions = objectFreeze({
  __proto__: null,
  force: true,
  maxRetries: 3,
  recursive: true,
  retryDelay: 200,
})

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

let _path: typeof import('path') | undefined
/**
 * Lazily load the path module to avoid Webpack errors.
 * Uses non-'node:' prefixed require to prevent Webpack bundling issues.
 *
 * @returns The Node.js path module
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('path')
}

/**
 * Process directory entries and filter for directories.
 * Filters entries to include only directories, optionally excluding empty ones.
 * Applies ignore patterns and natural sorting.
 *
 * @param dirents - Directory entries from readdir
 * @param dirname - Parent directory path
 * @param options - Filtering and sorting options
 * @returns Array of directory names, optionally sorted
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function innerReadDirNames(
  dirents: Dirent[],
  dirname: string | undefined,
  options?: ReadDirOptions | undefined,
): string[] {
  const {
    ignore,
    includeEmpty = true,
    sort = true,
  } = { __proto__: null, ...options } as ReadDirOptions
  const path = getPath()
  const names = dirents
    .filter(
      (d: Dirent) =>
        d.isDirectory() &&
        (includeEmpty ||
          !isDirEmptySync(path.join(dirname || d.parentPath, d.name), {
            ignore,
          })),
    )
    .map((d: Dirent) => d.name)
  return sort ? names.sort(naturalCompare) : names
}

/**
 * Stringify JSON with custom formatting options.
 * Formats JSON with configurable line endings and indentation.
 *
 * @param json - Value to stringify
 * @param EOL - End-of-line sequence
 * @param finalEOL - Whether to add final newline
 * @param replacer - JSON replacer function
 * @param spaces - Indentation spaces or string
 * @returns Formatted JSON string
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function stringify(
  json: unknown,
  EOL: string,
  finalEOL: boolean,
  replacer: JsonReviver | undefined,
  spaces: number | string = 2,
): string {
  const EOF = finalEOL ? EOL : ''
  const str = JSON.stringify(json, replacer, spaces)
  return `${str.replace(/\n/g, EOL)}${EOF}`
}

/**
 * Find a file or directory by traversing up parent directories.
 * Searches from the starting directory upward to the filesystem root.
 * Useful for finding configuration files or project roots.
 *
 * @param name - Filename(s) to search for
 * @param options - Search options including cwd and type filters
 * @returns Normalized absolute path if found, undefined otherwise
 *
 * @example
 * ```ts
 * // Find package.json starting from current directory
 * const pkgPath = await findUp('package.json')
 *
 * // Find any of multiple config files
 * const configPath = await findUp(['.config.js', '.config.json'])
 *
 * // Find a directory instead of file
 * const nodeModules = await findUp('node_modules', { onlyDirectories: true })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function findUp(
  name: string | string[] | readonly string[],
  options?: FindUpOptions | undefined,
): Promise<string | undefined> {
  const { cwd = process.cwd(), signal = abortSignal } = {
    __proto__: null,
    ...options,
  } as FindUpOptions
  let { onlyDirectories = false, onlyFiles = true } = {
    __proto__: null,
    ...options,
  } as FindUpOptions
  if (onlyDirectories) {
    onlyFiles = false
  }
  if (onlyFiles) {
    onlyDirectories = false
  }
  const fs = getFs()
  const path = getPath()
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = isArray(name) ? name : [name as string]
  while (dir && dir !== root) {
    for (const n of names) {
      if (signal?.aborted) {
        return undefined
      }
      const thePath = path.join(dir, n)
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.promises.stat(thePath)
        if (!onlyDirectories && stats.isFile()) {
          return normalizePath(thePath)
        }
        if (!onlyFiles && stats.isDirectory()) {
          return normalizePath(thePath)
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * Synchronously find a file or directory by traversing up parent directories.
 * Searches from the starting directory upward to the filesystem root or `stopAt` directory.
 * Useful for finding configuration files or project roots in synchronous contexts.
 *
 * @param name - Filename(s) to search for
 * @param options - Search options including cwd, stopAt, and type filters
 * @returns Normalized absolute path if found, undefined otherwise
 *
 * @example
 * ```ts
 * // Find package.json starting from current directory
 * const pkgPath = findUpSync('package.json')
 *
 * // Find .git directory but stop at home directory
 * const gitPath = findUpSync('.git', {
 *   onlyDirectories: true,
 *   stopAt: process.env.HOME
 * })
 *
 * // Find any of multiple config files
 * const configPath = findUpSync(['.eslintrc.js', '.eslintrc.json'])
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function findUpSync(
  name: string | string[] | readonly string[],
  options?: FindUpSyncOptions | undefined,
) {
  const { cwd = process.cwd(), stopAt } = {
    __proto__: null,
    ...options,
  } as FindUpSyncOptions
  let { onlyDirectories = false, onlyFiles = true } = {
    __proto__: null,
    ...options,
  } as FindUpSyncOptions
  if (onlyDirectories) {
    onlyFiles = false
  }
  if (onlyFiles) {
    onlyDirectories = false
  }
  const fs = getFs()
  const path = getPath()
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const stopDir = stopAt ? path.resolve(stopAt) : undefined
  const names = isArray(name) ? name : [name as string]
  while (dir && dir !== root) {
    // Check if we should stop at this directory.
    if (stopDir && dir === stopDir) {
      // Check current directory but don't go up.
      for (const n of names) {
        const thePath = path.join(dir, n)
        try {
          const stats = fs.statSync(thePath)
          if (!onlyDirectories && stats.isFile()) {
            return normalizePath(thePath)
          }
          if (!onlyFiles && stats.isDirectory()) {
            return normalizePath(thePath)
          }
        } catch {}
      }
      return undefined
    }
    for (const n of names) {
      const thePath = path.join(dir, n)
      try {
        const stats = fs.statSync(thePath)
        if (!onlyDirectories && stats.isFile()) {
          return normalizePath(thePath)
        }
        if (!onlyFiles && stats.isDirectory()) {
          return normalizePath(thePath)
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

/**
 * Check if a path is a directory asynchronously.
 * Returns `true` for directories, `false` for files or non-existent paths.
 *
 * @param filepath - Path to check
 * @returns `true` if path is a directory, `false` otherwise
 *
 * @example
 * ```ts
 * if (await isDir('./src')) {
 *   console.log('src is a directory')
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function isDir(filepath: PathLike) {
  return !!(await safeStats(filepath))?.isDirectory()
}

/**
 * Check if a path is a directory synchronously.
 * Returns `true` for directories, `false` for files or non-existent paths.
 *
 * @param filepath - Path to check
 * @returns `true` if path is a directory, `false` otherwise
 *
 * @example
 * ```ts
 * if (isDirSync('./src')) {
 *   console.log('src is a directory')
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isDirSync(filepath: PathLike) {
  return !!safeStatsSync(filepath)?.isDirectory()
}

/**
 * Check if a directory is empty synchronously.
 * A directory is considered empty if it contains no files after applying ignore patterns.
 * Uses glob patterns to filter ignored files.
 *
 * @param dirname - Directory path to check
 * @param options - Options including ignore patterns
 * @returns `true` if directory is empty (or doesn't exist), `false` otherwise
 *
 * @example
 * ```ts
 * // Check if directory is completely empty
 * isDirEmptySync('./build')
 *
 * // Check if directory is empty, ignoring .DS_Store files
 * isDirEmptySync('./cache', { ignore: ['.DS_Store'] })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isDirEmptySync(
  dirname: PathLike,
  options?: IsDirEmptyOptions | undefined,
) {
  const { ignore = defaultIgnore } = {
    __proto__: null,
    ...options,
  } as IsDirEmptyOptions
  const fs = getFs()
  try {
    const files = fs.readdirSync(dirname)
    const { length } = files
    if (length === 0) {
      return true
    }
    const matcher = getGlobMatcher(
      ignore as string[],
      {
        cwd: pathLikeToString(dirname),
      } as { cwd?: string; dot?: boolean; ignore?: string[]; nocase?: boolean },
    )
    let ignoredCount = 0
    for (let i = 0; i < length; i += 1) {
      const file = files[i]
      if (file && matcher(file)) {
        ignoredCount += 1
      }
    }
    return ignoredCount === length
  } catch {
    // Return false for non-existent paths or other errors.
    return false
  }
}

/**
 * Check if a path is a symbolic link synchronously.
 * Uses `lstat` to check the link itself, not the target.
 *
 * @param filepath - Path to check
 * @returns `true` if path is a symbolic link, `false` otherwise
 *
 * @example
 * ```ts
 * if (isSymLinkSync('./my-link')) {
 *   console.log('Path is a symbolic link')
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isSymLinkSync(filepath: PathLike) {
  const fs = getFs()
  try {
    return fs.lstatSync(filepath).isSymbolicLink()
  } catch {}
  return false
}

/**
 * Result of file readability validation.
 * Contains lists of valid and invalid file paths.
 */
export interface ValidateFilesResult {
  /**
   * File paths that passed validation and are readable.
   */
  validPaths: string[]
  /**
   * File paths that failed validation (unreadable, permission denied, or non-existent).
   * Common with Yarn Berry PnP virtual filesystem, pnpm symlinks, or filesystem race conditions.
   */
  invalidPaths: string[]
}

/**
 * Validate that file paths are readable before processing.
 * Filters out files from glob results that cannot be accessed (common with
 * Yarn Berry PnP virtual filesystem, pnpm content-addressable store symlinks,
 * or filesystem race conditions in CI/CD environments).
 *
 * This defensive pattern prevents ENOENT errors when files exist in glob
 * results but are not accessible via standard filesystem operations.
 *
 * @param filepaths - Array of file paths to validate
 * @returns Object with `validPaths` (readable) and `invalidPaths` (unreadable)
 *
 * @example
 * ```ts
 * import { validateFiles } from '@socketsecurity/lib/fs'
 *
 * const files = ['package.json', '.pnp.cjs/virtual-file.json']
 * const { validPaths, invalidPaths } = validateFiles(files)
 *
 * console.log(`Valid: ${validPaths.length}`)
 * console.log(`Invalid: ${invalidPaths.length}`)
 * ```
 *
 * @example
 * ```ts
 * // Typical usage in Socket CLI commands
 * const packagePaths = await getPackageFilesForScan(targets)
 * const { validPaths } = validateFiles(packagePaths)
 * await sdk.uploadManifestFiles(orgSlug, validPaths)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function validateFiles(
  filepaths: string[] | readonly string[],
): ValidateFilesResult {
  const fs = getFs()
  const validPaths: string[] = []
  const invalidPaths: string[] = []
  const { R_OK } = fs.constants

  for (const filepath of filepaths) {
    try {
      fs.accessSync(filepath, R_OK)
      validPaths.push(filepath)
    } catch {
      invalidPaths.push(filepath)
    }
  }

  return { __proto__: null, validPaths, invalidPaths } as ValidateFilesResult
}

/**
 * Read directory names asynchronously with filtering and sorting.
 * Returns only directory names (not files), with optional filtering for empty directories
 * and glob-based ignore patterns. Results are naturally sorted by default.
 *
 * @param dirname - Directory path to read
 * @param options - Options for filtering and sorting
 * @returns Array of directory names, empty array on error
 *
 * @example
 * ```ts
 * // Get all subdirectories, sorted naturally
 * const dirs = await readDirNames('./packages')
 *
 * // Get non-empty directories only
 * const nonEmpty = await readDirNames('./cache', { includeEmpty: false })
 *
 * // Get directories without sorting
 * const unsorted = await readDirNames('./src', { sort: false })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function readDirNames(
  dirname: PathLike,
  options?: ReadDirOptions | undefined,
) {
  const fs = getFs()
  try {
    return innerReadDirNames(
      await fs.promises.readdir(dirname, {
        __proto__: null,
        encoding: 'utf8',
        withFileTypes: true,
      } as ObjectEncodingOptions & { withFileTypes: true }),
      String(dirname),
      options,
    )
  } catch {}
  return []
}

/**
 * Read directory names synchronously with filtering and sorting.
 * Returns only directory names (not files), with optional filtering for empty directories
 * and glob-based ignore patterns. Results are naturally sorted by default.
 *
 * @param dirname - Directory path to read
 * @param options - Options for filtering and sorting
 * @returns Array of directory names, empty array on error
 *
 * @example
 * ```ts
 * // Get all subdirectories, sorted naturally
 * const dirs = readDirNamesSync('./packages')
 *
 * // Get non-empty directories only, ignoring node_modules
 * const nonEmpty = readDirNamesSync('./src', {
 *   includeEmpty: false,
 *   ignore: ['node_modules']
 * })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function readDirNamesSync(dirname: PathLike, options?: ReadDirOptions) {
  const fs = getFs()
  try {
    return innerReadDirNames(
      fs.readdirSync(dirname, {
        __proto__: null,
        encoding: 'utf8',
        withFileTypes: true,
      } as ObjectEncodingOptions & { withFileTypes: true }),
      String(dirname),
      options,
    )
  } catch {}
  return []
}

/**
 * Read a file as binary data asynchronously.
 * Returns a Buffer without encoding the contents.
 * Useful for reading images, archives, or other binary formats.
 *
 * @param filepath - Path to file
 * @param options - Read options (encoding is forced to null for binary)
 * @returns Promise resolving to Buffer containing file contents
 *
 * @example
 * ```ts
 * // Read an image file
 * const imageBuffer = await readFileBinary('./image.png')
 *
 * // Read with abort signal
 * const buffer = await readFileBinary('./data.bin', { signal: abortSignal })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function readFileBinary(
  filepath: PathLike,
  options?: ReadFileOptions | undefined,
) {
  // Don't specify encoding to get a Buffer.
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  return await fs.promises.readFile(filepath, {
    signal: abortSignal,
    ...opts,
    encoding: null,
  })
}

/**
 * Read a file as UTF-8 text asynchronously.
 * Returns a string with the file contents decoded as UTF-8.
 * This is the most common way to read text files.
 *
 * @param filepath - Path to file
 * @param options - Read options including encoding and abort signal
 * @returns Promise resolving to string containing file contents
 *
 * @example
 * ```ts
 * // Read a text file
 * const content = await readFileUtf8('./README.md')
 *
 * // Read with custom encoding
 * const content = await readFileUtf8('./data.txt', { encoding: 'utf-8' })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function readFileUtf8(
  filepath: PathLike,
  options?: ReadFileOptions | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  return await fs.promises.readFile(filepath, {
    signal: abortSignal,
    ...opts,
    encoding: 'utf8',
  })
}

/**
 * Read a file as binary data synchronously.
 * Returns a Buffer without encoding the contents.
 * Useful for reading images, archives, or other binary formats.
 *
 * @param filepath - Path to file
 * @param options - Read options (encoding is forced to null for binary)
 * @returns Buffer containing file contents
 *
 * @example
 * ```ts
 * // Read an image file
 * const imageBuffer = readFileBinarySync('./logo.png')
 *
 * // Read a compressed file
 * const gzipData = readFileBinarySync('./archive.gz')
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function readFileBinarySync(
  filepath: PathLike,
  options?: ReadFileOptions | undefined,
) {
  // Don't specify encoding to get a Buffer
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  return fs.readFileSync(filepath, {
    ...opts,
    encoding: null,
  } as ObjectEncodingOptions)
}

/**
 * Read a file as UTF-8 text synchronously.
 * Returns a string with the file contents decoded as UTF-8.
 * This is the most common way to read text files synchronously.
 *
 * @param filepath - Path to file
 * @param options - Read options including encoding
 * @returns String containing file contents
 *
 * @example
 * ```ts
 * // Read a configuration file
 * const config = readFileUtf8Sync('./config.txt')
 *
 * // Read with custom options
 * const data = readFileUtf8Sync('./data.txt', { encoding: 'utf8' })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function readFileUtf8Sync(
  filepath: PathLike,
  options?: ReadFileOptions | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  return fs.readFileSync(filepath, {
    ...opts,
    encoding: 'utf8',
  } as ObjectEncodingOptions)
}

/**
 * Read and parse a JSON file asynchronously.
 * Reads the file as UTF-8 text and parses it as JSON.
 * Optionally accepts a reviver function to transform parsed values.
 *
 * @param filepath - Path to JSON file
 * @param options - Read and parse options
 * @returns Promise resolving to parsed JSON value, or undefined if throws is false and an error occurs
 *
 * @example
 * ```ts
 * // Read and parse package.json
 * const pkg = await readJson('./package.json')
 *
 * // Read JSON with custom reviver
 * const data = await readJson('./data.json', {
 *   reviver: (key, value) => {
 *     if (key === 'date') return new Date(value)
 *     return value
 *   }
 * })
 *
 * // Don't throw on parse errors
 * const config = await readJson('./config.json', { throws: false })
 * if (config === undefined) {
 *   console.log('Failed to parse config')
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function readJson(
  filepath: PathLike,
  options?: ReadJsonOptions | string | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const { reviver, throws, ...fsOptions } = {
    __proto__: null,
    ...opts,
  } as unknown as ReadJsonOptions
  const shouldThrow = throws === undefined || !!throws
  const fs = getFs()
  let content = ''
  try {
    content = await fs.promises.readFile(filepath, {
      __proto__: null,
      encoding: 'utf8',
      ...fsOptions,
    } as unknown as Parameters<typeof fs.promises.readFile>[1] & {
      encoding: string
    })
  } catch (e) {
    if (shouldThrow) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(
          `JSON file not found: ${filepath}\n` +
            'Ensure the file exists or create it with the expected structure.',
          { cause: e },
        )
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Permission denied reading JSON file: ${filepath}\n` +
            'Check file permissions or run with appropriate access.',
          { cause: e },
        )
      }
      throw e
    }
    return undefined
  }
  return jsonParse(content, {
    filepath: String(filepath),
    reviver,
    throws: shouldThrow,
  })
}

/**
 * Read and parse a JSON file synchronously.
 * Reads the file as UTF-8 text and parses it as JSON.
 * Optionally accepts a reviver function to transform parsed values.
 *
 * @param filepath - Path to JSON file
 * @param options - Read and parse options
 * @returns Parsed JSON value, or undefined if throws is false and an error occurs
 *
 * @example
 * ```ts
 * // Read and parse tsconfig.json
 * const tsconfig = readJsonSync('./tsconfig.json')
 *
 * // Read JSON with custom reviver
 * const data = readJsonSync('./data.json', {
 *   reviver: (key, value) => {
 *     if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
 *       return new Date(value)
 *     }
 *     return value
 *   }
 * })
 *
 * // Don't throw on parse errors
 * const config = readJsonSync('./config.json', { throws: false })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function readJsonSync(
  filepath: PathLike,
  options?: ReadJsonOptions | string | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const { reviver, throws, ...fsOptions } = {
    __proto__: null,
    ...opts,
  } as unknown as ReadJsonOptions
  const shouldThrow = throws === undefined || !!throws
  const fs = getFs()
  let content = ''
  try {
    content = fs.readFileSync(filepath, {
      __proto__: null,
      encoding: 'utf8',
      ...fsOptions,
    } as unknown as Parameters<typeof fs.readFileSync>[1] & {
      encoding: string
    })
  } catch (e) {
    if (shouldThrow) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(
          `JSON file not found: ${filepath}\n` +
            'Ensure the file exists or create it with the expected structure.',
          { cause: e },
        )
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Permission denied reading JSON file: ${filepath}\n` +
            'Check file permissions or run with appropriate access.',
          { cause: e },
        )
      }
      throw e
    }
    return undefined
  }
  return jsonParse(content, {
    filepath: String(filepath),
    reviver,
    throws: shouldThrow,
  })
}

// Cache for resolved allowed directories
let _cachedAllowedDirs: string[] | undefined

/**
 * Get resolved allowed directories for safe deletion with lazy caching.
 * These directories are resolved once and cached for the process lifetime.
 */
function getAllowedDirectories(): string[] {
  if (_cachedAllowedDirs === undefined) {
    const path = getPath()
    const {
      getOsTmpDir,
      getSocketCacacheDir,
      getSocketUserDir,
    } = /*@__PURE__*/ require('#lib/paths')

    _cachedAllowedDirs = [
      path.resolve(getOsTmpDir()),
      path.resolve(getSocketCacacheDir()),
      path.resolve(getSocketUserDir()),
    ]
  }
  return _cachedAllowedDirs
}

/**
 * Invalidate the cached allowed directories.
 * Called automatically by the paths/rewire module when paths are overridden in tests.
 *
 * @internal Used for test rewiring
 */
export function invalidatePathCache(): void {
  _cachedAllowedDirs = undefined
}

// Register cache invalidation with the rewire module
registerCacheInvalidation(invalidatePathCache)

/**
 * Safely delete a file or directory asynchronously with built-in protections.
 * Uses `del` for safer deletion that prevents removing cwd and above by default.
 * Automatically uses force: true for temp directory, cacache, and ~/.socket subdirectories.
 *
 * @param filepath - Path or array of paths to delete (supports glob patterns)
 * @param options - Deletion options including force, retries, and recursion
 * @throws {Error} When attempting to delete protected paths without force option
 *
 * @example
 * ```ts
 * // Delete a single file
 * await safeDelete('./temp-file.txt')
 *
 * // Delete a directory recursively
 * await safeDelete('./build', { recursive: true })
 *
 * // Delete multiple paths
 * await safeDelete(['./dist', './coverage'])
 *
 * // Delete with custom retry settings
 * await safeDelete('./flaky-dir', { maxRetries: 5, retryDelay: 500 })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function safeDelete(
  filepath: PathLike | PathLike[],
  options?: RemoveOptions | undefined,
) {
  const del = /*@__PURE__*/ require('del')
  const { deleteAsync } = del
  const opts = { __proto__: null, ...options } as RemoveOptions
  const patterns = isArray(filepath)
    ? filepath.map(pathLikeToString)
    : [pathLikeToString(filepath)]

  // Check if we're deleting within allowed directories.
  let shouldForce = opts.force !== false
  if (!shouldForce && patterns.length > 0) {
    const path = getPath()
    const allowedDirs = getAllowedDirectories()

    // Check if all patterns are within allowed directories.
    const allInAllowedDirs = patterns.every(pattern => {
      const resolvedPath = path.resolve(pattern)

      // Check each allowed directory
      for (const allowedDir of allowedDirs) {
        const isInAllowedDir =
          resolvedPath.startsWith(allowedDir + path.sep) ||
          resolvedPath === allowedDir
        const relativePath = path.relative(allowedDir, resolvedPath)
        const isGoingBackward = relativePath.startsWith('..')

        if (isInAllowedDir && !isGoingBackward) {
          return true
        }
      }

      return false
    })

    if (allInAllowedDirs) {
      shouldForce = true
    }
  }

  await deleteAsync(patterns, {
    concurrency: opts.maxRetries || defaultRemoveOptions.maxRetries,
    dryRun: false,
    force: shouldForce,
    onlyFiles: false,
  })
}

/**
 * Safely delete a file or directory synchronously with built-in protections.
 * Uses `del` for safer deletion that prevents removing cwd and above by default.
 * Automatically uses force: true for temp directory, cacache, and ~/.socket subdirectories.
 *
 * @param filepath - Path or array of paths to delete (supports glob patterns)
 * @param options - Deletion options including force, retries, and recursion
 * @throws {Error} When attempting to delete protected paths without force option
 *
 * @example
 * ```ts
 * // Delete a single file
 * safeDeleteSync('./temp-file.txt')
 *
 * // Delete a directory recursively
 * safeDeleteSync('./build', { recursive: true })
 *
 * // Delete multiple paths with globs
 * safeDeleteSync(['./dist/**', './coverage/**'])
 *
 * // Force delete a protected path (use with caution)
 * safeDeleteSync('./important', { force: true })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function safeDeleteSync(
  filepath: PathLike | PathLike[],
  options?: RemoveOptions | undefined,
) {
  const del = /*@__PURE__*/ require('del')
  const { deleteSync } = del
  const opts = { __proto__: null, ...options } as RemoveOptions
  const patterns = isArray(filepath)
    ? filepath.map(pathLikeToString)
    : [pathLikeToString(filepath)]

  // Check if we're deleting within allowed directories.
  let shouldForce = opts.force !== false
  if (!shouldForce && patterns.length > 0) {
    const path = getPath()
    const allowedDirs = getAllowedDirectories()

    // Check if all patterns are within allowed directories.
    const allInAllowedDirs = patterns.every(pattern => {
      const resolvedPath = path.resolve(pattern)

      // Check each allowed directory
      for (const allowedDir of allowedDirs) {
        const isInAllowedDir =
          resolvedPath.startsWith(allowedDir + path.sep) ||
          resolvedPath === allowedDir
        const relativePath = path.relative(allowedDir, resolvedPath)
        const isGoingBackward = relativePath.startsWith('..')

        if (isInAllowedDir && !isGoingBackward) {
          return true
        }
      }

      return false
    })

    if (allInAllowedDirs) {
      shouldForce = true
    }
  }

  deleteSync(patterns, {
    concurrency: opts.maxRetries || defaultRemoveOptions.maxRetries,
    dryRun: false,
    force: shouldForce,
    onlyFiles: false,
  })
}

/**
 * Safely create a directory asynchronously, ignoring EEXIST errors.
 * This function wraps fs.promises.mkdir and handles the race condition where
 * the directory might already exist, which is common in concurrent code.
 *
 * Unlike fs.promises.mkdir with recursive:true, this function:
 * - Silently ignores EEXIST errors (directory already exists)
 * - Re-throws all other errors (permissions, invalid path, etc.)
 * - Works reliably in multi-process/concurrent scenarios
 * - Defaults to recursive: true for convenient nested directory creation
 *
 * @param path - Directory path to create
 * @param options - Options including recursive (default: true) and mode settings
 * @returns Promise that resolves when directory is created or already exists
 *
 * @example
 * ```ts
 * // Create a directory recursively by default, no error if it exists
 * await safeMkdir('./config')
 *
 * // Create nested directories (recursive: true is the default)
 * await safeMkdir('./data/cache/temp')
 *
 * // Create with specific permissions
 * await safeMkdir('./secure', { mode: 0o700 })
 *
 * // Explicitly disable recursive behavior
 * await safeMkdir('./single-level', { recursive: false })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function safeMkdir(
  path: PathLike,
  options?: MakeDirectoryOptions | undefined,
): Promise<void> {
  const fs = getFs()
  const opts = { __proto__: null, recursive: true, ...options }
  try {
    await fs.promises.mkdir(path, opts)
  } catch (e: unknown) {
    // Ignore EEXIST error - directory already exists.
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      e.code !== 'EEXIST'
    ) {
      throw e
    }
  }
}

/**
 * Safely create a directory synchronously, ignoring EEXIST errors.
 * This function wraps fs.mkdirSync and handles the race condition where
 * the directory might already exist, which is common in concurrent code.
 *
 * Unlike fs.mkdirSync with recursive:true, this function:
 * - Silently ignores EEXIST errors (directory already exists)
 * - Re-throws all other errors (permissions, invalid path, etc.)
 * - Works reliably in multi-process/concurrent scenarios
 * - Defaults to recursive: true for convenient nested directory creation
 *
 * @param path - Directory path to create
 * @param options - Options including recursive (default: true) and mode settings
 *
 * @example
 * ```ts
 * // Create a directory recursively by default, no error if it exists
 * safeMkdirSync('./config')
 *
 * // Create nested directories (recursive: true is the default)
 * safeMkdirSync('./data/cache/temp')
 *
 * // Create with specific permissions
 * safeMkdirSync('./secure', { mode: 0o700 })
 *
 * // Explicitly disable recursive behavior
 * safeMkdirSync('./single-level', { recursive: false })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function safeMkdirSync(
  path: PathLike,
  options?: MakeDirectoryOptions | undefined,
): void {
  const fs = getFs()
  const opts = { __proto__: null, recursive: true, ...options }
  try {
    fs.mkdirSync(path, opts)
  } catch (e: unknown) {
    // Ignore EEXIST error - directory already exists.
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      e.code !== 'EEXIST'
    ) {
      throw e
    }
  }
}

/**
 * Safely read a file asynchronously, returning undefined on error.
 * Useful when you want to attempt reading a file without handling errors explicitly.
 * Returns undefined for any error (file not found, permission denied, etc.).
 *
 * @param filepath - Path to file
 * @param options - Read options including encoding and default value
 * @returns Promise resolving to file contents, or undefined on error
 *
 * @example
 * ```ts
 * // Try to read a file, get undefined if it doesn't exist
 * const content = await safeReadFile('./optional-config.txt')
 * if (content) {
 *   console.log('Config found:', content)
 * }
 *
 * // Read with specific encoding
 * const data = await safeReadFile('./data.txt', { encoding: 'utf8' })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function safeReadFile(
  filepath: PathLike,
  options?: SafeReadOptions | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  try {
    return await fs.promises.readFile(filepath, {
      signal: abortSignal,
      ...opts,
    } as Abortable)
  } catch {}
  return undefined
}

/**
 * Safely read a file synchronously, returning undefined on error.
 * Useful when you want to attempt reading a file without handling errors explicitly.
 * Returns undefined for any error (file not found, permission denied, etc.).
 *
 * @param filepath - Path to file
 * @param options - Read options including encoding and default value
 * @returns File contents, or undefined on error
 *
 * @example
 * ```ts
 * // Try to read a config file
 * const config = safeReadFileSync('./config.txt')
 * if (config) {
 *   console.log('Config loaded successfully')
 * }
 *
 * // Read binary file safely
 * const buffer = safeReadFileSync('./image.png', { encoding: null })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function safeReadFileSync(
  filepath: PathLike,
  options?: SafeReadOptions | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  try {
    return fs.readFileSync(filepath, {
      __proto__: null,
      ...opts,
    } as ObjectEncodingOptions)
  } catch {}
  return undefined
}

/**
 * Safely get file stats asynchronously, returning undefined on error.
 * Useful for checking file existence and properties without error handling.
 * Returns undefined for any error (file not found, permission denied, etc.).
 *
 * @param filepath - Path to check
 * @returns Promise resolving to Stats object, or undefined on error
 *
 * @example
 * ```ts
 * // Check if file exists and get its stats
 * const stats = await safeStats('./file.txt')
 * if (stats) {
 *   console.log('File size:', stats.size)
 *   console.log('Modified:', stats.mtime)
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function safeStats(filepath: PathLike) {
  const fs = getFs()
  try {
    return await fs.promises.stat(filepath)
  } catch {}
  return undefined
}

/**
 * Safely get file stats synchronously, returning undefined on error.
 * Useful for checking file existence and properties without error handling.
 * Returns undefined for any error (file not found, permission denied, etc.).
 *
 * @param filepath - Path to check
 * @param options - Read options (currently unused but kept for API consistency)
 * @returns Stats object, or undefined on error
 *
 * @example
 * ```ts
 * // Check if file exists and get its size
 * const stats = safeStatsSync('./file.txt')
 * if (stats) {
 *   console.log('File size:', stats.size)
 *   console.log('Is directory:', stats.isDirectory())
 * }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function safeStatsSync(
  filepath: PathLike,
  options?: ReadFileOptions | undefined,
) {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const fs = getFs()
  try {
    return fs.statSync(filepath, {
      __proto__: null,
      throwIfNoEntry: false,
      ...opts,
    } as StatSyncOptions)
  } catch {}
  return undefined
}

/**
 * Generate a unique filepath by adding number suffix if the path exists.
 * Appends `-1`, `-2`, etc. before the file extension until a non-existent path is found.
 * Useful for creating files without overwriting existing ones.
 *
 * @param filepath - Desired file path
 * @returns Normalized unique filepath (original if it doesn't exist, or with number suffix)
 *
 * @example
 * ```ts
 * // If 'report.pdf' exists, returns 'report-1.pdf'
 * const uniquePath = uniqueSync('./report.pdf')
 *
 * // If 'data.json' and 'data-1.json' exist, returns 'data-2.json'
 * const path = uniqueSync('./data.json')
 *
 * // If 'backup' doesn't exist, returns 'backup' unchanged
 * const backupPath = uniqueSync('./backup')
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function uniqueSync(filepath: PathLike): string {
  const fs = getFs()
  const path = getPath()
  const filepathStr = String(filepath)

  // If the file doesn't exist, return as is
  if (!fs.existsSync(filepathStr)) {
    return normalizePath(filepathStr)
  }

  const dirname = path.dirname(filepathStr)
  const ext = path.extname(filepathStr)
  const basename = path.basename(filepathStr, ext)

  let counter = 1
  let uniquePath: string
  do {
    uniquePath = path.join(dirname, `${basename}-${counter}${ext}`)
    counter++
  } while (fs.existsSync(uniquePath))

  return normalizePath(uniquePath)
}

/**
 * Write JSON content to a file asynchronously with formatting.
 * Stringifies the value with configurable indentation and line endings.
 * Automatically adds a final newline by default for POSIX compliance.
 *
 * @param filepath - Path to write to
 * @param jsonContent - Value to stringify and write
 * @param options - Write options including formatting and encoding
 * @returns Promise that resolves when write completes
 *
 * @example
 * ```ts
 * // Write formatted JSON with default 2-space indentation
 * await writeJson('./data.json', { name: 'example', version: '1.0.0' })
 *
 * // Write with custom indentation
 * await writeJson('./config.json', config, { spaces: 4 })
 *
 * // Write with tabs instead of spaces
 * await writeJson('./data.json', data, { spaces: '\t' })
 *
 * // Write without final newline
 * await writeJson('./inline.json', obj, { finalEOL: false })
 *
 * // Write with Windows line endings
 * await writeJson('./win.json', data, { EOL: '\r\n' })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export async function writeJson(
  filepath: PathLike,
  jsonContent: unknown,
  options?: WriteJsonOptions | string,
): Promise<void> {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const { EOL, finalEOL, replacer, spaces, ...fsOptions } = {
    __proto__: null,
    ...opts,
  } as WriteJsonOptions
  const fs = getFs()
  const jsonString = stringify(
    jsonContent,
    EOL || '\n',
    finalEOL !== undefined ? finalEOL : true,
    replacer,
    spaces,
  )
  await fs.promises.writeFile(filepath, jsonString, {
    encoding: 'utf8',
    ...fsOptions,
    __proto__: null,
  } as ObjectEncodingOptions)
}

/**
 * Write JSON content to a file synchronously with formatting.
 * Stringifies the value with configurable indentation and line endings.
 * Automatically adds a final newline by default for POSIX compliance.
 *
 * @param filepath - Path to write to
 * @param jsonContent - Value to stringify and write
 * @param options - Write options including formatting and encoding
 *
 * @example
 * ```ts
 * // Write formatted JSON with default 2-space indentation
 * writeJsonSync('./package.json', pkg)
 *
 * // Write with custom indentation
 * writeJsonSync('./tsconfig.json', tsconfig, { spaces: 4 })
 *
 * // Write with tabs for indentation
 * writeJsonSync('./data.json', data, { spaces: '\t' })
 *
 * // Write compacted (no indentation)
 * writeJsonSync('./compact.json', data, { spaces: 0 })
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function writeJsonSync(
  filepath: PathLike,
  jsonContent: unknown,
  options?: WriteJsonOptions | string | undefined,
): void {
  const opts = typeof options === 'string' ? { encoding: options } : options
  const { EOL, finalEOL, replacer, spaces, ...fsOptions } = {
    __proto__: null,
    ...opts,
  }
  const fs = getFs()
  const jsonString = stringify(
    jsonContent,
    EOL || '\n',
    finalEOL !== undefined ? finalEOL : true,
    replacer,
    spaces,
  )
  fs.writeFileSync(filepath, jsonString, {
    encoding: 'utf8',
    ...fsOptions,
    __proto__: null,
  } as WriteFileOptions)
}
