/** @fileoverview Error filtering to make the CLI feel professional, not like a raw Node.js application. */

import process from 'node:process'
import { Transform } from 'node:stream'

/**
 * Check if we should show stack traces based on environment
 */
function shouldShowStackTraces(): boolean {
  return !!(
    process.env['DEBUG'] ||
    process.env['SOCKET_CLI_DEBUG'] ||
    process.env['NODE_ENV'] === 'development' ||
    process.env['NODE_ENV'] === 'test' ||
    process.env['CI']
  )
}

/**
 * Patterns that indicate Node.js internal errors we want to filter
 */
const NODE_ERROR_PATTERNS = [
  // Node.js module resolution errors
  /^Error: Cannot find module/,
  /^Error \[ERR_MODULE_NOT_FOUND\]/,
  /^ReferenceError: .* is not defined$/,
  /^TypeError: Cannot read propert/,
  /^TypeError: .* is not a function$/,

  // Stack trace lines
  /^\s*at\s+.*\(/,  // "    at functionName (/path/to/file.js:123:45)"
  /^\s*at\s+\/.*:\d+:\d+$/,  // "    at /path/to/file.js:123:45"
  /^\s*at\s+node:/,  // Node internal modules
  /^\s*at\s+async\s+/,  // Async stack traces

  // Node.js internal paths
  /node_modules\//,
  /internal\/modules\//,
  /internal\/process\//,

  // V8 error decoration
  /^\s*\^+$/,  // Error position indicators like "^^^^^"
  /^SyntaxError:/,

  // Node warnings
  /^\(node:\d+\)/,  // "(node:12345) Warning: ..."
  /^DeprecationWarning:/,
  /^ExperimentalWarning:/,

  // Build errors that leak through
  /^\[!?\]\s*(Circular dependencies|Mixing named)/,
  /^\[BABEL\]/,
  /rollupjs\.org/,
]

/**
 * Clean error messages to be more user-friendly
 */
function cleanErrorMessage(line: string): string | null {
  // Skip empty lines in error output
  if (!line.trim()) {
    return null
  }

  // Skip Node.js internal error patterns unless in debug mode
  if (!shouldShowStackTraces()) {
    for (const pattern of NODE_ERROR_PATTERNS) {
      if (pattern.test(line)) {
        return null
      }
    }
  }

  // Clean up common Node.js error prefixes
  line = line
    .replace(/^Error:\s+/, '')  // Remove "Error: " prefix
    .replace(/^TypeError:\s+/, '')
    .replace(/^ReferenceError:\s+/, '')
    .replace(/^RangeError:\s+/, '')

  // Clean up file paths to be relative
  if (process.cwd()) {
    line = line.replace(new RegExp(process.cwd() + '/', 'g'), './')
  }

  return line
}

/**
 * Create a transform stream that filters error output
 */
export function createErrorFilterStream(): Transform {
  let buffer = ''

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = buffer + chunk.toString()
      const lines = text.split('\n')

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      const filtered: string[] = []
      let inStackTrace = false

      for (const line of lines) {
        // Detect start of stack trace
        if (/^\s*at\s+/.test(line)) {
          inStackTrace = true
        }

        // Reset stack trace detection on non-stack line
        if (inStackTrace && !/^\s*at\s+/.test(line) && line.trim()) {
          inStackTrace = false
        }

        // Skip stack traces unless in debug mode
        if (inStackTrace && !shouldShowStackTraces()) {
          continue
        }

        const cleaned = cleanErrorMessage(line)
        if (cleaned !== null) {
          filtered.push(cleaned)
        }
      }

      if (filtered.length > 0) {
        callback(null, filtered.join('\n') + '\n')
      } else {
        callback()
      }
    },

    flush(callback) {
      if (buffer) {
        const cleaned = cleanErrorMessage(buffer)
        if (cleaned !== null) {
          callback(null, cleaned + '\n')
        } else {
          callback()
        }
      } else {
        callback()
      }
    },
  })
}

/**
 * Install error filtering on process streams
 */
export function installErrorFiltering(): void {
  // Don't filter in test environment - tests need to see everything
  if (process.env['NODE_ENV'] === 'test' || process.env['VITEST']) {
    return
  }

  // Create filter streams
  const stderrFilter = createErrorFilterStream()

  // Save original stderr write
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  // Override stderr.write to filter output
  process.stderr.write = function(chunk: any, encodingOrCallback?: any, callback?: any): boolean {
    // Handle different overload signatures
    let encoding: BufferEncoding | undefined
    let cb: ((error?: Error) => void) | undefined

    if (typeof encodingOrCallback === 'function') {
      cb = encodingOrCallback
    } else {
      encoding = encodingOrCallback
      cb = callback
    }

    // Convert to Buffer if needed
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), encoding as BufferEncoding || 'utf8')

    // Filter the output
    let filtered = false
    stderrFilter.write(buffer, undefined, (error, result) => {
      if (error) {
        originalStderrWrite(chunk, encoding, cb)
      } else if (result) {
        originalStderrWrite(result, 'utf8', cb)
        filtered = true
      } else if (cb) {
        // Nothing to write, but call callback
        cb()
        filtered = true
      }
    })

    return filtered || originalStderrWrite('', cb)
  }
}

/**
 * Check if an error should be shown as a stack trace
 */
export function shouldShowFullError(error: unknown): boolean {
  if (shouldShowStackTraces()) {
    return true
  }

  // Show stack for unexpected errors
  if (error instanceof Error) {
    // Don't show stack for known user errors
    const userErrorMessages = [
      'missing required',
      'invalid option',
      'unknown command',
      'authentication required',
      'api token',
      'permission denied',
      'not found',
      'already exists',
    ]

    const message = error.message.toLowerCase()
    return !userErrorMessages.some(pattern => message.includes(pattern))
  }

  return false
}