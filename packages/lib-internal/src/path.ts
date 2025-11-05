/**
 * @fileoverview Path manipulation utilities with cross-platform support.
 * Provides path normalization, validation, and file extension handling.
 */

import { WIN32 } from '#constants/platform'

import { search } from './strings'

// Character code constants.
// '\'
const CHAR_BACKWARD_SLASH = 92
// ':'
const CHAR_COLON = 58
// '/'
const CHAR_FORWARD_SLASH = 47
// 'a'
const CHAR_LOWERCASE_A = 97
// 'z'
const CHAR_LOWERCASE_Z = 122
// 'A'
const CHAR_UPPERCASE_A = 65
// 'Z'
const CHAR_UPPERCASE_Z = 90

// Regular expressions.
const slashRegExp = /[/\\]/
const nodeModulesPathRegExp = /(?:^|[/\\])node_modules(?:[/\\]|$)/

/**
 * Check if a character code represents a path separator.
 *
 * Determines whether the given character code is either a forward slash (/) or
 * backslash (\), which are used as path separators across different platforms.
 *
 * @param {number} code - The character code to check
 * @returns {boolean} `true` if the code represents a path separator, `false` otherwise
 *
 * @example
 * ```typescript
 * isPathSeparator(47)  // true - forward slash '/'
 * isPathSeparator(92)  // true - backslash '\'
 * isPathSeparator(65)  // false - letter 'A'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function isPathSeparator(code: number): boolean {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH
}

/**
 * Check if a character code represents a Windows device root letter.
 *
 * Tests whether the given character code falls within the valid range for
 * Windows drive letters (A-Z or a-z). These letters are used at the start
 * of Windows absolute paths (e.g., `C:\`, `D:\`).
 *
 * @param {number} code - The character code to check
 * @returns {boolean} `true` if the code is a valid drive letter, `false` otherwise
 *
 * @example
 * ```typescript
 * isWindowsDeviceRoot(67)  // true - letter 'C'
 * isWindowsDeviceRoot(99)  // true - letter 'c'
 * isWindowsDeviceRoot(58)  // false - colon ':'
 * isWindowsDeviceRoot(47)  // false - forward slash '/'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function isWindowsDeviceRoot(code: number): boolean {
  return (
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
    (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z)
  )
}

let _buffer: typeof import('node:buffer') | undefined
/**
 * Lazily load the buffer module.
 *
 * Performs on-demand loading of Node.js buffer module to avoid initialization
 * overhead and potential Webpack bundling errors.
 *
 * @private
 * @returns {typeof import('node:buffer')} The buffer module
 */
/*@__NO_SIDE_EFFECTS__*/
function getBuffer() {
  if (_buffer === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _buffer = /*@__PURE__*/ require('node:buffer')
  }
  return _buffer as typeof import('node:buffer')
}

let _url: typeof import('node:url') | undefined
/**
 * Lazily load the url module.
 *
 * Performs on-demand loading of Node.js url module to avoid initialization
 * overhead and potential Webpack bundling errors.
 *
 * @private
 * @returns {typeof import('node:url')} The url module
 */
/*@__NO_SIDE_EFFECTS__*/
function getUrl() {
  if (_url === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _url = /*@__PURE__*/ require('node:url')
  }
  return _url as typeof import('node:url')
}

/**
 * Check if a path contains node_modules directory.
 *
 * Detects whether a given path includes a `node_modules` directory segment.
 * This is useful for identifying npm package dependencies and filtering
 * dependency-related paths.
 *
 * The check matches `node_modules` appearing as a complete path segment,
 * ensuring it is either at the start, end, or surrounded by path separators.
 *
 * @param {string | Buffer | URL} pathLike - The path to check
 * @returns {boolean} `true` if the path contains `node_modules`, `false` otherwise
 *
 * @example
 * ```typescript
 * isNodeModules('/project/node_modules/package')    // true
 * isNodeModules('node_modules/package/index.js')    // true
 * isNodeModules('/src/my_node_modules_backup')      // false
 * isNodeModules('/project/src/index.js')            // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNodeModules(pathLike: string | Buffer | URL): boolean {
  const filepath = pathLikeToString(pathLike)
  return nodeModulesPathRegExp.test(filepath)
}

/**
 * Check if a path is absolute.
 *
 * An absolute path is one that specifies a location from the root of the file system.
 * This function handles both POSIX and Windows path formats.
 *
 * POSIX absolute paths:
 * - Start with forward slash '/'
 * - Examples: '/home/user', '/usr/bin/node'
 *
 * Windows absolute paths (3 types):
 * 1. Drive-letter paths: Start with drive letter + colon + separator
 *    - Format: [A-Za-z]:[\\/]
 *    - Examples: 'C:\Windows', 'D:/data', 'c:\Program Files'
 *    - Reference: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#file-and-directory-names
 *
 * 2. UNC paths: Start with double backslash (handled by backslash check)
 *    - Format: \\server\share
 *    - Examples: '\\server\share\file', '\\?\C:\path'
 *    - Reference: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#unc-names
 *
 * 3. Device paths: Start with backslash
 *    - Examples: '\Windows', '\\.\device'
 *    - Note: Single backslash paths are relative to current drive
 *
 * @param {string | Buffer | URL} pathLike - The path to check
 * @returns {boolean} `true` if the path is absolute, `false` otherwise
 *
 * @example
 * ```typescript
 * // POSIX paths
 * isAbsolute('/home/user')           // true
 * isAbsolute('/usr/bin/node')        // true
 *
 * // Windows paths
 * isAbsolute('C:\\Windows')          // true
 * isAbsolute('D:/data')              // true
 * isAbsolute('\\\\server\\share')    // true
 *
 * // Relative paths
 * isAbsolute('../relative')          // false
 * isAbsolute('relative/path')        // false
 * isAbsolute('.')                    // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isAbsolute(pathLike: string | Buffer | URL): boolean {
  const filepath = pathLikeToString(pathLike)
  const { length } = filepath

  // Empty paths are not absolute.
  if (length === 0) {
    return false
  }

  const code = filepath.charCodeAt(0)

  // POSIX: absolute paths start with forward slash '/'.
  // This is the simplest case and works for all UNIX-like systems.
  if (code === CHAR_FORWARD_SLASH) {
    return true
  }

  // Windows: absolute paths can start with backslash '\'.
  // This includes UNC paths (\\server\share) and device paths (\\.\ or \\?\).
  // Single backslash is technically relative to current drive, but treated as absolute.
  if (code === CHAR_BACKWARD_SLASH) {
    return true
  }

  // Windows: drive-letter absolute paths (e.g., C:\, D:\).
  // Format: [A-Za-z]:[\\/]
  // Requires at least 3 characters: drive letter + colon + separator.
  // Only treat as absolute on Windows platforms.
  if (WIN32 && length > 2) {
    // Check if first character is a letter (A-Z or a-z).
    // Check if second character is colon ':'.
    // Check if third character is a path separator (forward or backslash).
    // This matches patterns like 'C:\', 'D:/', 'c:\Users', etc.
    if (
      isWindowsDeviceRoot(code) &&
      filepath.charCodeAt(1) === CHAR_COLON &&
      isPathSeparator(filepath.charCodeAt(2))
    ) {
      return true
    }
  }

  // Not an absolute path.
  return false
}

/**
 * Check if a value is a valid file path (absolute or relative).
 *
 * Determines whether a given value represents a valid file system path.
 * This function distinguishes between file paths and other string formats
 * like package names, URLs, or bare module specifiers.
 *
 * Valid paths include:
 * - Absolute paths (e.g., `/usr/bin`, `C:\Windows`)
 * - Relative paths with separators (e.g., `./src`, `../lib`)
 * - Special relative paths (`.`, `..`)
 * - Paths starting with `@` that have subpaths (e.g., `@scope/name/file`)
 *
 * Not considered paths:
 * - URLs with protocols (e.g., `http://`, `file://`, `git:`)
 * - Bare package names (e.g., `lodash`, `react`)
 * - Scoped package names without subpaths (e.g., `@scope/name`)
 *
 * @param {string | Buffer | URL} pathLike - The value to check
 * @returns {boolean} `true` if the value is a valid file path, `false` otherwise
 *
 * @example
 * ```typescript
 * // Valid paths
 * isPath('/absolute/path')           // true
 * isPath('./relative/path')          // true
 * isPath('../parent/dir')            // true
 * isPath('.')                        // true
 * isPath('..')                       // true
 * isPath('@scope/name/subpath')      // true
 * isPath('C:\\Windows')              // true (Windows)
 *
 * // Not paths
 * isPath('lodash')                   // false - bare package name
 * isPath('@scope/package')           // false - scoped package name
 * isPath('http://example.com')       // false - URL
 * isPath('file://path')              // false - file URL
 * isPath('')                         // false - empty string
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isPath(pathLike: string | Buffer | URL): boolean {
  const filepath = pathLikeToString(pathLike)
  if (typeof filepath !== 'string' || filepath.length === 0) {
    return false
  }

  // Exclude URLs with protocols (file:, http:, https:, git:, etc.).
  // These should be handled by package spec parsers, not treated as file paths.
  // Require at least 2 characters before colon to exclude Windows drive letters (C:, D:).
  if (/^[a-z][a-z0-9+.-]+:/i.test(filepath)) {
    return false
  }

  // Special relative paths.
  if (filepath === '.' || filepath === '..') {
    return true
  }

  // Absolute paths are always valid paths.
  if (isAbsolute(filepath)) {
    return true
  }

  // Contains path separators, so it's a path.
  if (filepath.includes('/') || filepath.includes('\\')) {
    // Distinguish scoped package names from paths starting with '@'.
    // Scoped packages: @scope/name (exactly 2 parts, no backslashes).
    // Paths: @scope/name/subpath (3+ parts) or @scope\name (Windows backslash).
    // Special case: '@/' is a valid path (already handled by separator check).
    if (filepath.startsWith('@') && !filepath.startsWith('@/')) {
      const parts = filepath.split('/')
      // If exactly @scope/name with no Windows separators, it's a package name.
      if (parts.length <= 2 && !parts[1]?.includes('\\')) {
        return false
      }
    }
    return true
  }

  // Bare names without separators are package names, not paths.
  return false
}

/**
 * Check if a path is relative.
 *
 * Determines whether a given path is relative (i.e., not absolute). A path
 * is considered relative if it does not specify a location from the root of
 * the file system.
 *
 * Relative paths include:
 * - Paths starting with `.` or `..` (e.g., `./src`, `../lib`)
 * - Paths without leading separators (e.g., `src/file.js`)
 * - Empty strings (treated as relative)
 *
 * @param {string | Buffer | URL} pathLike - The path to check
 * @returns {boolean} `true` if the path is relative, `false` if absolute
 *
 * @example
 * ```typescript
 * // Relative paths
 * isRelative('./src/index.js')       // true
 * isRelative('../lib/util.js')       // true
 * isRelative('src/file.js')          // true
 * isRelative('')                     // true
 *
 * // Absolute paths
 * isRelative('/home/user')           // false
 * isRelative('C:\\Windows')          // false (Windows)
 * isRelative('\\\\server\\share')    // false (Windows UNC)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isRelative(pathLike: string | Buffer | URL): boolean {
  const filepath = pathLikeToString(pathLike)
  if (typeof filepath !== 'string') {
    return false
  }
  // Empty string is considered relative.
  if (filepath.length === 0) {
    return true
  }
  // A path is relative if it's not absolute.
  return !isAbsolute(filepath)
}

/**
 * Normalize a path by converting backslashes to forward slashes and collapsing segments.
 *
 * This function performs several normalization operations:
 * - Converts all backslashes (`\`) to forward slashes (`/`)
 * - Collapses repeated slashes into single slashes
 * - Resolves `.` (current directory) segments
 * - Resolves `..` (parent directory) segments
 * - Preserves UNC path prefixes (`//server/share`)
 * - Preserves Windows namespace prefixes (`//./`, `//?/`)
 * - Returns `.` for empty or collapsed paths
 *
 * Special handling:
 * - UNC paths: Maintains double leading slashes for `//server/share` format
 * - Windows namespaces: Preserves `//./` and `//?/` prefixes
 * - Leading `..` segments: Preserved in relative paths without prefix
 * - Trailing components: Properly handled when resolving `..`
 *
 * @param {string | Buffer | URL} pathLike - The path to normalize
 * @returns {string} The normalized path with forward slashes and collapsed segments
 *
 * @example
 * ```typescript
 * // Basic normalization
 * normalizePath('foo/bar//baz')              // 'foo/bar/baz'
 * normalizePath('foo/./bar')                 // 'foo/bar'
 * normalizePath('foo/bar/../baz')            // 'foo/baz'
 *
 * // Windows paths
 * normalizePath('C:\\Users\\username\\file.txt') // 'C:/Users/username/file.txt'
 * normalizePath('foo\\bar\\baz')                 // 'foo/bar/baz'
 *
 * // UNC paths
 * normalizePath('\\\\server\\share\\file')   // '//server/share/file'
 *
 * // Edge cases
 * normalizePath('')                          // '.'
 * normalizePath('.')                         // '.'
 * normalizePath('..')                        // '..'
 * normalizePath('///foo///bar///')           // '/foo/bar'
 * normalizePath('foo/../..')                 // '..'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function normalizePath(pathLike: string | Buffer | URL): string {
  const filepath = pathLikeToString(pathLike)
  const { length } = filepath
  if (length === 0) {
    return '.'
  }
  if (length < 2) {
    return length === 1 && filepath.charCodeAt(0) === 92 /*'\\'*/
      ? '/'
      : filepath
  }

  let code = 0
  let start = 0

  // Ensure win32 namespaces have two leading slashes so they are handled properly
  // by path.win32.parse() after being normalized.
  // https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#namespaces
  // UNC paths, paths starting with double slashes, e.g. "\\\\wsl.localhost\\Ubuntu\home\\",
  // are okay to convert to forward slashes.
  // https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions
  let prefix = ''
  if (length > 4 && filepath.charCodeAt(3) === 92 /*'\\'*/) {
    const code2 = filepath.charCodeAt(2)
    // Look for \\?\ or \\.\
    if (
      (code2 === 63 /*'?'*/ || code2 === 46) /*'.'*/ &&
      filepath.charCodeAt(0) === 92 /*'\\'*/ &&
      filepath.charCodeAt(1) === 92 /*'\\'*/
    ) {
      start = 2
      prefix = '//'
    }
  }
  if (start === 0) {
    // Check for UNC paths first (\\server\share or //server/share)
    // UNC paths must start with exactly two slashes, not more
    if (
      length > 2 &&
      ((filepath.charCodeAt(0) === 92 /*'\\'*/ &&
        filepath.charCodeAt(1) === 92 /*'\\'*/ &&
        filepath.charCodeAt(2) !== 92) /*'\\'*/ ||
        (filepath.charCodeAt(0) === 47 /*'/'*/ &&
          filepath.charCodeAt(1) === 47 /*'/'*/ &&
          filepath.charCodeAt(2) !== 47)) /*'/'*/
    ) {
      // Check if this is a valid UNC path: must have server/share format
      // Find the first segment (server name) and second segment (share name)
      let firstSegmentEnd = -1
      let hasSecondSegment = false

      // Skip leading slashes after the initial double slash
      let i = 2
      while (
        i < length &&
        (filepath.charCodeAt(i) === 47 /*'/'*/ ||
          filepath.charCodeAt(i) === 92) /*'\\'*/
      ) {
        i++
      }

      // Find the end of first segment (server name)
      while (i < length) {
        const char = filepath.charCodeAt(i)
        if (char === 47 /*'/'*/ || char === 92 /*'\\'*/) {
          firstSegmentEnd = i
          break
        }
        i++
      }

      if (firstSegmentEnd > 2) {
        // Skip slashes after server name
        i = firstSegmentEnd
        while (
          i < length &&
          (filepath.charCodeAt(i) === 47 /*'/'*/ ||
            filepath.charCodeAt(i) === 92) /*'\\'*/
        ) {
          i++
        }
        // Check if there's a share name (second segment)
        if (i < length) {
          hasSecondSegment = true
        }
      }

      if (firstSegmentEnd > 2 && hasSecondSegment) {
        // Valid UNC path - preserve double leading slashes
        start = 2
        prefix = '//'
      } else {
        // Just repeated slashes, treat as regular path
        code = filepath.charCodeAt(start)
        while (code === 47 /*'/'*/ || code === 92 /*'\\'*/) {
          start += 1
          code = filepath.charCodeAt(start)
        }
        if (start) {
          prefix = '/'
        }
      }
    } else {
      // Trim leading slashes for regular paths
      code = filepath.charCodeAt(start)
      while (code === 47 /*'/'*/ || code === 92 /*'\\'*/) {
        start += 1
        code = filepath.charCodeAt(start)
      }
      if (start) {
        prefix = '/'
      }
    }
  }
  let nextIndex = search(filepath, slashRegExp, { fromIndex: start })
  if (nextIndex === -1) {
    const segment = filepath.slice(start)
    if (segment === '.' || segment.length === 0) {
      return prefix || '.'
    }
    if (segment === '..') {
      return prefix ? prefix.slice(0, -1) || '/' : '..'
    }
    return prefix + segment
  }
  // Process segments and handle '.', '..', and empty segments.
  let collapsed = ''
  let segmentCount = 0
  let leadingDotDots = 0
  while (nextIndex !== -1) {
    const segment = filepath.slice(start, nextIndex)
    if (segment.length > 0 && segment !== '.') {
      if (segment === '..') {
        // Handle '..' by removing the last segment if possible.
        if (segmentCount > 0) {
          // Find the last separator and remove the last segment.
          const lastSeparatorIndex = collapsed.lastIndexOf('/')
          if (lastSeparatorIndex === -1) {
            // Only one segment, remove it entirely.
            collapsed = ''
            segmentCount = 0
            // Check if this was a leading '..', restore it.
            if (leadingDotDots > 0 && !prefix) {
              collapsed = '..'
              leadingDotDots = 1
            }
          } else {
            const lastSegmentStart = lastSeparatorIndex + 1
            const lastSegmentValue = collapsed.slice(lastSegmentStart)
            // Don't collapse leading '..' segments.
            if (lastSegmentValue === '..') {
              // Preserve the '..' and add another one.
              collapsed = `${collapsed}/${segment}`
              leadingDotDots += 1
            } else {
              // Normal collapse: remove the last segment.
              collapsed = collapsed.slice(0, lastSeparatorIndex)
              segmentCount -= 1
            }
          }
        } else if (!prefix) {
          // Preserve '..' for relative paths.
          collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
          leadingDotDots += 1
        }
      } else {
        collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + segment
        segmentCount += 1
      }
    }
    start = nextIndex + 1
    code = filepath.charCodeAt(start)
    while (code === 47 /*'/'*/ || code === 92 /*'\\'*/) {
      start += 1
      code = filepath.charCodeAt(start)
    }
    nextIndex = search(filepath, slashRegExp, { fromIndex: start })
  }
  const lastSegment = filepath.slice(start)
  if (lastSegment.length > 0 && lastSegment !== '.') {
    if (lastSegment === '..') {
      if (segmentCount > 0) {
        const lastSeparatorIndex = collapsed.lastIndexOf('/')
        if (lastSeparatorIndex === -1) {
          collapsed = ''
          segmentCount = 0
          // Check if this was a leading '..', restore it.
          if (leadingDotDots > 0 && !prefix) {
            collapsed = '..'
            leadingDotDots = 1
          }
        } else {
          const lastSegmentStart = lastSeparatorIndex + 1
          const lastSegmentValue = collapsed.slice(lastSegmentStart)
          // Don't collapse leading '..' segments.
          if (lastSegmentValue === '..') {
            // Preserve the '..' and add another one.
            collapsed = `${collapsed}/${lastSegment}`
            leadingDotDots += 1
          } else {
            // Normal collapse: remove the last segment.
            collapsed = collapsed.slice(0, lastSeparatorIndex)
            segmentCount -= 1
          }
        }
      } else if (!prefix) {
        collapsed =
          collapsed + (collapsed.length === 0 ? '' : '/') + lastSegment
        leadingDotDots += 1
      }
    } else {
      collapsed = collapsed + (collapsed.length === 0 ? '' : '/') + lastSegment
      segmentCount += 1
    }
  }

  if (collapsed.length === 0) {
    return prefix || '.'
  }
  return prefix + collapsed
}

/**
 * Convert a path-like value to a string.
 *
 * Converts various path-like types (string, Buffer, URL) into a normalized
 * string representation. This function handles different input formats and
 * provides consistent string output for path operations.
 *
 * Supported input types:
 * - `string`: Returned as-is
 * - `Buffer`: Decoded as UTF-8 string
 * - `URL`: Converted using `fileURLToPath()`, with fallback for malformed URLs
 * - `null` / `undefined`: Returns empty string
 *
 * URL handling:
 * - Valid file URLs are converted via `url.fileURLToPath()`
 * - Malformed URLs fall back to pathname extraction with decoding
 * - Windows drive letters in URLs are handled specially
 * - Percent-encoded characters are decoded (e.g., `%20` becomes space)
 *
 * @param {string | Buffer | URL | null | undefined} pathLike - The path-like value to convert
 * @returns {string} The string representation of the path, or empty string for null/undefined
 *
 * @example
 * ```typescript
 * // String input
 * pathLikeToString('/home/user')                        // '/home/user'
 *
 * // Buffer input
 * pathLikeToString(Buffer.from('/tmp/file'))            // '/tmp/file'
 *
 * // URL input
 * pathLikeToString(new URL('file:///home/user'))        // '/home/user'
 * pathLikeToString(new URL('file:///C:/Windows'))       // 'C:/Windows' (Windows)
 *
 * // Null/undefined input
 * pathLikeToString(null)                                // ''
 * pathLikeToString(undefined)                           // ''
 *
 * // Percent-encoded URLs
 * pathLikeToString(new URL('file:///path%20with%20spaces'))  // '/path with spaces'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function pathLikeToString(
  pathLike: string | Buffer | URL | null | undefined,
): string {
  if (pathLike === null || pathLike === undefined) {
    return ''
  }
  if (typeof pathLike === 'string') {
    return pathLike
  }
  const { Buffer } = getBuffer()
  if (Buffer.isBuffer(pathLike)) {
    return pathLike.toString('utf8')
  }
  const url = getUrl()
  if (pathLike instanceof URL) {
    try {
      return url.fileURLToPath(pathLike)
    } catch {
      // On Windows, file URLs like `file:///C:/path` include drive letters.
      // If a file URL is missing its drive letter (malformed), fileURLToPath() throws an error.
      // This fallback extracts the pathname directly from the URL object.
      //
      // Example flows:
      // - Unix: file:///home/user → pathname '/home/user' → keep as-is
      // - Windows valid: file:///C:/path → handled by fileURLToPath()
      // - Windows invalid: file:///path → pathname '/path' → strips to 'path'
      const pathname = pathLike.pathname

      // Decode percent-encoded characters (e.g., %20 → space).
      // The pathname property keeps URL encoding, but file paths need decoded characters.
      // This is not platform-specific; all URLs use percent-encoding regardless of OS.
      const decodedPathname = decodeURIComponent(pathname)

      // URL pathnames always start with `/`.
      // On Windows, strip the leading slash only for malformed URLs that lack drive letters
      // (e.g., `/path` should be `path`, but `/C:/path` should be `C:/path`).
      // On Unix, keep the leading slash for absolute paths (e.g., `/home/user`).
      if (WIN32 && decodedPathname.startsWith('/')) {
        // Check for drive letter pattern following Node.js source: /[a-zA-Z]:/
        // Character at index 1 should be a letter, character at index 2 should be ':'
        // Convert to lowercase
        const letter = decodedPathname.charCodeAt(1) | 0x20
        const hasValidDriveLetter =
          decodedPathname.length >= 3 &&
          letter >= 97 &&
          // 'a' to 'z'
          letter <= 122 &&
          decodedPathname.charAt(2) === ':'

        if (!hasValidDriveLetter) {
          // On Windows, preserve Unix-style absolute paths that don't start with a drive letter.
          // Only strip the leading slash for truly malformed Windows paths.
          // Since fileURLToPath() failed, this is likely a valid Unix-style absolute path.
          return decodedPathname
        }
      }
      return decodedPathname
    }
  }
  return String(pathLike)
}

/**
 * Split a path into an array of segments.
 *
 * Divides a path into individual components by splitting on path separators
 * (both forward slashes and backslashes). This is useful for path traversal,
 * analysis, and manipulation.
 *
 * The function handles:
 * - Forward slashes (`/`) on all platforms
 * - Backslashes (`\`) on Windows
 * - Mixed separators in a single path
 * - Empty paths (returns empty array)
 *
 * Note: The resulting array may contain empty strings if the path has leading,
 * trailing, or consecutive separators (e.g., `/foo//bar/` becomes `['', 'foo', '', 'bar', '']`).
 *
 * @param {string | Buffer | URL} pathLike - The path to split
 * @returns {string[]} Array of path segments, or empty array for empty paths
 *
 * @example
 * ```typescript
 * // POSIX paths
 * splitPath('/home/user/file.txt')      // ['', 'home', 'user', 'file.txt']
 * splitPath('src/lib/util.js')          // ['src', 'lib', 'util.js']
 *
 * // Windows paths
 * splitPath('C:\\Users\\John')          // ['C:', 'Users', 'John']
 * splitPath('folder\\file.txt')         // ['folder', 'file.txt']
 *
 * // Mixed separators
 * splitPath('path/to\\file')            // ['path', 'to', 'file']
 *
 * // Edge cases
 * splitPath('')                         // []
 * splitPath('/')                        // ['', '']
 * splitPath('/foo//bar/')               // ['', 'foo', '', 'bar', '']
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function splitPath(pathLike: string | Buffer | URL): string[] {
  const filepath = pathLikeToString(pathLike)
  if (filepath === '') {
    return []
  }
  return filepath.split(slashRegExp)
}

/**
 * Remove leading ./ or ../ from a path.
 *
 * Strips the `./` or `.\` prefix from relative paths. This is useful for
 * normalizing paths when the current directory reference is implicit or
 * unwanted.
 *
 * Note: This function only removes a single leading `./` or `.\`. It does
 * not remove `../` prefixes or process the rest of the path.
 *
 * @param {string | Buffer | URL} pathLike - The path to process
 * @returns {string} The path without leading `./` or `.\`, or unchanged if no such prefix
 *
 * @example
 * ```typescript
 * // Remove ./ prefix
 * trimLeadingDotSlash('./src/index.js')     // 'src/index.js'
 * trimLeadingDotSlash('.\\src\\file.txt')   // 'src\\file.txt'
 *
 * // Preserve ../ prefix
 * trimLeadingDotSlash('../lib/util.js')     // '../lib/util.js'
 *
 * // No change for other paths
 * trimLeadingDotSlash('/absolute/path')     // '/absolute/path'
 * trimLeadingDotSlash('relative/path')      // 'relative/path'
 * trimLeadingDotSlash('.')                  // '.'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function trimLeadingDotSlash(pathLike: string | Buffer | URL): string {
  const filepath = pathLikeToString(pathLike)
  // Only trim ./ not ../
  if (filepath.startsWith('./') || filepath.startsWith('.\\')) {
    return filepath.slice(2)
  }
  return filepath
}

/**
 * Resolve an absolute path from path segments.
 *
 * This function mimics Node.js `path.resolve()` behavior by building an
 * absolute path from the given segments. It processes segments from right
 * to left, stopping when an absolute path is encountered. If no absolute
 * path is found, it prepends the current working directory.
 *
 * Algorithm:
 * 1. Process segments from right to left
 * 2. Stop when an absolute path is found
 * 3. Prepend current working directory if no absolute path found
 * 4. Normalize the final path
 *
 * Key behaviors:
 * - Later segments override earlier ones (e.g., `resolve('/foo', '/bar')` returns `/bar`)
 * - Empty or non-string segments are skipped
 * - Result is always an absolute path
 * - Path separators are normalized to forward slashes
 *
 * @param {...string} segments - Path segments to resolve
 * @returns {string} The resolved absolute path
 *
 * @example
 * ```typescript
 * // Basic resolution
 * resolve('foo', 'bar', 'baz')           // '/cwd/foo/bar/baz' (assuming cwd is '/cwd')
 * resolve('/foo', 'bar', 'baz')          // '/foo/bar/baz'
 * resolve('foo', '/bar', 'baz')          // '/bar/baz'
 *
 * // Windows paths
 * resolve('C:\\foo', 'bar')              // 'C:/foo/bar'
 *
 * // Empty segments
 * resolve('foo', '', 'bar')              // '/cwd/foo/bar'
 * resolve()                              // '/cwd' (current directory)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function resolve(...segments: string[]): string {
  let resolvedPath = ''
  let resolvedAbsolute = false

  // Process segments from right to left until we find an absolute path.
  // This allows later segments to override earlier ones.
  // Example: resolve('/foo', '/bar') returns '/bar', not '/foo/bar'.
  for (let i = segments.length - 1; i >= 0 && !resolvedAbsolute; i -= 1) {
    const segment = segments[i]

    // Skip empty or non-string segments.
    if (typeof segment !== 'string' || segment.length === 0) {
      continue
    }

    // Prepend the segment to the resolved path.
    // Use forward slashes as separators (normalized later).
    resolvedPath =
      segment + (resolvedPath.length === 0 ? '' : `/${resolvedPath}`)

    // Check if this segment is absolute.
    // Absolute paths stop the resolution process.
    resolvedAbsolute = isAbsolute(segment)
  }

  // If no absolute path was found in segments, prepend current working directory.
  // This ensures the final path is always absolute.
  if (!resolvedAbsolute) {
    const cwd = /*@__PURE__*/ require('node:process').cwd()
    resolvedPath = cwd + (resolvedPath.length === 0 ? '' : `/${resolvedPath}`)
  }

  // Normalize the resolved path (collapse '..' and '.', convert separators).
  return normalizePath(resolvedPath)
}

/**
 * Calculate the relative path from one path to another.
 *
 * This function computes how to get from the `from` path to the `to` path
 * using relative path notation. Both paths are first resolved to absolute
 * paths, then compared to find the common base path, and finally a relative
 * path is constructed using `../` for parent directory traversal.
 *
 * Algorithm:
 * 1. Resolve both paths to absolute
 * 2. Find the longest common path prefix (up to a separator)
 * 3. For each remaining directory in `from`, add `../` to go up
 * 4. Append the remaining path from `to`
 *
 * Windows-specific behavior:
 * - File system paths are case-insensitive on Windows (NTFS, FAT32)
 * - `C:\Foo` and `c:\foo` are considered the same path
 * - Reference: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 * - Case is preserved but not significant for comparison
 *
 * @param {string} from - The source path (starting point)
 * @param {string} to - The destination path (target)
 * @returns {string} The relative path from `from` to `to`, or empty string if paths are identical
 *
 * @example
 * ```typescript
 * // Basic relative paths
 * relative('/foo/bar', '/foo/baz')           // '../baz'
 * relative('/foo/bar/baz', '/foo')           // '../..'
 * relative('/foo', '/foo/bar')               // 'bar'
 *
 * // Same paths
 * relative('/foo/bar', '/foo/bar')           // ''
 *
 * // Windows case-insensitive
 * relative('C:\\Foo\\bar', 'C:\\foo\\baz')   // '../baz' (Windows)
 *
 * // Root paths
 * relative('/', '/foo/bar')                  // 'foo/bar'
 * relative('/foo/bar', '/')                  // '../..'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function relative(from: string, to: string): string {
  // Quick return if paths are already identical.
  if (from === to) {
    return ''
  }

  // Resolve both paths to absolute.
  // This handles relative paths, '.', '..', and ensures consistent format.
  const actualFrom = resolve(from)
  const actualTo = resolve(to)

  // Check again after resolution (paths might have been equivalent).
  if (actualFrom === actualTo) {
    return ''
  }

  // Windows: perform case-insensitive comparison.
  // NTFS and FAT32 preserve case but are case-insensitive for lookups.
  // This means 'C:\Foo\bar.txt' and 'c:\foo\BAR.TXT' refer to the same file.
  // Reference: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#case-sensitivity
  if (WIN32) {
    const fromLower = actualFrom.toLowerCase()
    const toLower = actualTo.toLowerCase()
    if (fromLower === toLower) {
      return ''
    }
  }

  // Skip the leading separator for comparison.
  // We compare paths starting after the root separator to find common directories.
  // Example: '/foo/bar' becomes 'foo/bar' for comparison (index 1).
  const fromStart = 1
  const fromEnd = actualFrom.length
  const fromLen = fromEnd - fromStart
  const toStart = 1
  const toEnd = actualTo.length
  const toLen = toEnd - toStart

  // Compare paths character by character to find the longest common prefix.
  // We only consider a common prefix valid if it ends at a directory separator.
  const length = fromLen < toLen ? fromLen : toLen
  // Index of last common directory separator.
  let lastCommonSep = -1
  let i = 0

  for (; i < length; i += 1) {
    let fromCode = actualFrom.charCodeAt(fromStart + i)
    let toCode = actualTo.charCodeAt(toStart + i)

    // Paths diverge at this character.
    // On Windows, perform case-insensitive comparison.
    if (WIN32) {
      // Normalize to lowercase for case-insensitive comparison.
      // Convert A-Z (65-90) to a-z (97-122).
      if (fromCode >= CHAR_UPPERCASE_A && fromCode <= CHAR_UPPERCASE_Z) {
        fromCode += 32
      }
      if (toCode >= CHAR_UPPERCASE_A && toCode <= CHAR_UPPERCASE_Z) {
        toCode += 32
      }
    }

    if (fromCode !== toCode) {
      break
    }

    // Track directory separators (both forward and backslash for Windows compatibility).
    // We need this to ensure we only split at directory boundaries.
    // Use original fromCode from actualFrom (before case normalization).
    if (isPathSeparator(actualFrom.charCodeAt(fromStart + i))) {
      lastCommonSep = i
    }
  }

  // Handle edge cases where one path is a prefix of the other.
  if (i === length) {
    if (toLen > length) {
      // Destination path is longer.
      const toCode = actualTo.charCodeAt(toStart + i)
      if (isPathSeparator(toCode)) {
        // `from` is the exact base path for `to`.
        // Example: from='/foo/bar'; to='/foo/bar/baz' → 'baz'
        // Skip the separator character (+1) to get just the relative portion.
        return actualTo.slice(toStart + i + 1)
      }
      if (i === 0) {
        // `from` is the root directory.
        // Example: from='/'; to='/foo' → 'foo'
        return actualTo.slice(toStart + i)
      }
    } else if (fromLen > length) {
      // Source path is longer.
      const fromCode = actualFrom.charCodeAt(fromStart + i)
      if (isPathSeparator(fromCode)) {
        // `to` is the exact base path for `from`.
        // Example: from='/foo/bar/baz'; to='/foo/bar' → '..'
        // We need to go up from the extra directory.
        lastCommonSep = i
      } else if (i === 0) {
        // `to` is the root directory.
        // Example: from='/foo'; to='/' → '..'
        lastCommonSep = 0
      }
    }
  }

  // Generate the relative path by constructing '../' segments.
  let out = ''

  // Count the number of directories in `from` after the common base.
  // For each directory, we need to go up one level ('../').
  // Example: from='/a/b/c', to='/a/x' → common='a', need '../..' (up from c, up from b)
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; i += 1) {
    const code = actualFrom.charCodeAt(i)

    // At the end of the path or at a separator, add '../'.
    if (i === fromEnd || isPathSeparator(code)) {
      out += out.length === 0 ? '..' : '/..'
    }
  }

  // Append the rest of the destination path after the common base.
  // This gives us the path from the common ancestor to the destination.
  return out + actualTo.slice(toStart + lastCommonSep)
}

/**
 * Get the relative path from one path to another.
 *
 * Computes the relative path from `from` to `to` and normalizes the result.
 * This is a convenience wrapper around the `relative()` function that adds
 * path normalization (converting separators and collapsing segments).
 *
 * The function:
 * 1. Calculates the relative path using `relative()`
 * 2. Normalizes the result using `normalizePath()`
 * 3. Preserves empty strings (same path) without converting to `.`
 *
 * @param {string} from - The source path (starting point)
 * @param {string} to - The destination path (target)
 * @returns {string} The normalized relative path from `from` to `to`, or empty string if paths are identical
 *
 * @example
 * ```typescript
 * // Basic usage
 * relativeResolve('/foo/bar', '/foo/baz')         // '../baz'
 * relativeResolve('/foo/bar/baz', '/foo')         // '../..'
 * relativeResolve('/foo', '/foo/bar')             // 'bar'
 *
 * // Same paths
 * relativeResolve('/foo/bar', '/foo/bar')         // ''
 *
 * // Windows paths (normalized)
 * relativeResolve('C:\\foo\\bar', 'C:\\foo\\baz') // '../baz'
 *
 * // With normalization
 * relativeResolve('/foo/./bar', '/foo/baz')       // '../baz'
 * relativeResolve('/foo/bar/../baz', '/foo/qux')  // '../qux'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function relativeResolve(from: string, to: string): string {
  const rel = relative(from, to)
  // Empty string means same path - don't normalize to '.'
  if (rel === '') {
    return ''
  }
  return normalizePath(rel)
}
