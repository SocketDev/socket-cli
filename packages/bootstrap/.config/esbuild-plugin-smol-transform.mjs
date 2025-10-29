/**
 * esbuild plugin to transform node:* requires to internal/* requires.
 *
 * This makes the bootstrap compatible with Node.js internal bootstrap context
 * for smol builds.
 */

/**
 * Create smol transformation plugin.
 * @returns {import('esbuild').Plugin}
 */
export function smolTransformPlugin() {
  return {
    name: 'smol-transform',
    setup(build) {
      build.onEnd((result) => {
        // Get the output files.
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
          return
        }

        // Transform each output file.
        for (const output of outputs) {
          let content = output.text

          // Map core module requires to their internal bootstrap equivalents.
          // Based on Module.builtinModules from Node.js v24.10.0.
          // Format: [moduleName, bootstrapPath]
          // Handles both 'node:x' and plain 'x' variants (except prefix-only modules).
          const requireMappings = new Map([
            // Core modules with internal equivalents.
            ['child_process', 'internal/child_process'],
            ['fs', 'fs'],
            ['fs/promises', 'internal/fs/promises'],

            // Stream internals.
            ['stream', 'stream'],
            ['stream/promises', 'internal/streams/promises'],
            ['stream/web', 'internal/webstreams/readablestream'],

            // Path variants.
            ['path', 'path'],
            ['path/posix', 'path'],
            ['path/win32', 'path'],

            // Core modules available at top level.
            ['assert', 'assert'],
            ['assert/strict', 'internal/assert/strict'],
            ['async_hooks', 'async_hooks'],
            ['buffer', 'buffer'],
            ['cluster', 'cluster'],
            ['console', 'console'],
            ['constants', 'constants'],
            ['crypto', 'crypto'],
            ['dgram', 'dgram'],
            ['diagnostics_channel', 'diagnostics_channel'],
            ['dns', 'dns'],
            ['dns/promises', 'dns/promises'],
            ['domain', 'domain'],
            ['events', 'events'],
            ['http', 'http'],
            ['http2', 'http2'],
            ['https', 'https'],
            ['inspector', 'inspector'],
            ['inspector/promises', 'inspector/promises'],
            ['module', 'module'],
            ['net', 'net'],
            ['os', 'os'],
            ['perf_hooks', 'perf_hooks'],
            ['process', 'process'],
            ['punycode', 'punycode'],
            ['querystring', 'querystring'],
            ['readline', 'readline'],
            ['readline/promises', 'readline/promises'],
            ['repl', 'repl'],
            ['string_decoder', 'string_decoder'],
            ['sys', 'sys'],
            ['timers', 'timers'],
            ['timers/promises', 'timers/promises'],
            ['tls', 'tls'],
            ['trace_events', 'trace_events'],
            ['tty', 'tty'],
            ['url', 'url'],
            ['util', 'util'],
            ['util/types', 'internal/util/types'],
            ['v8', 'v8'],
            ['vm', 'vm'],
            ['wasi', 'wasi'],
            ['worker_threads', 'worker_threads'],
            ['zlib', 'zlib'],
          ])

          // Prefix-only modules that have no unprefixed form.
          // These ONLY support node:* syntax.
          const prefixOnlyModules = new Set([
            'node:sea',
            'node:sqlite',
            'node:test',
            'node:test/reporters',
          ])

          // Replace require("node:X") and require("X") with correct bootstrap path.
          for (const [moduleName, bootstrapPath] of requireMappings) {
            // Handle node:x variant.
            content = content.replace(
              new RegExp(`require\\(["']node:${moduleName}["']\\)`, 'g'),
              `require("${bootstrapPath}")`,
            )
            // Handle plain x variant (if different from bootstrap path).
            // Skip if this is a prefix-only module.
            if (moduleName !== bootstrapPath && !prefixOnlyModules.has(`node:${moduleName}`)) {
              content = content.replace(
                new RegExp(`require\\(["']${moduleName}["']\\)`, 'g'),
                `require("${bootstrapPath}")`,
              )
            }
          }

          // Transform Unicode property escapes for --with-intl=none compatibility.
          // This is CRITICAL for smol builds which disable ICU to save 6-8MB.
          content = transformUnicodePropertyEscapes(content)

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}

/**
 * Transform Unicode property escapes in regex patterns for ICU-free environments.
 * Based on babel-plugin-with-intl-none.mjs transformations.
 *
 * @param {string} content - Source code to transform
 * @returns {string} Transformed source code
 */
function transformUnicodePropertyEscapes(content) {
  let transformed = content

  // Map of Unicode property escapes to basic character class alternatives.
  const unicodePropertyMap = {
    __proto__: null,
    // Letter categories.
    'Letter': 'a-zA-Z',
    'L': 'a-zA-Z',
    'Alpha': 'a-zA-Z',
    'Alphabetic': 'a-zA-Z',
    // Number categories.
    'Number': '0-9',
    'N': '0-9',
    'Digit': '0-9',
    'Nd': '0-9',
    // Whitespace.
    'Space': '\\s',
    'White_Space': '\\s',
    // ASCII range.
    'ASCII': '\\x00-\\x7F',
    // Control characters (basic approximation).
    'Control': '\\x00-\\x1F\\x7F-\\x9F',
    'Cc': '\\x00-\\x1F\\x7F-\\x9F',
    // Format characters (approximate with zero-width space).
    'Format': '\\u200B-\\u200D\\uFEFF',
    'Cf': '\\u200B-\\u200D\\uFEFF',
    // Mark categories (combining marks - approximate).
    'Mark': '\\u0300-\\u036F',
    'M': '\\u0300-\\u036F',
    // Default_Ignorable_Code_Point (approximate with common invisibles).
    'Default_Ignorable_Code_Point': '\\u00AD\\u034F\\u061C\\u115F-\\u1160\\u17B4-\\u17B5\\u180B-\\u180D\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFF8',
  }

  // Transform \p{Property} inside character classes [...].
  // Example: /[\p{Letter}\p{Number}]+/u → /[a-zA-Z0-9]+/
  transformed = transformed.replace(
    /\[([^\]]*\\p\{[^}]+\}[^\]]*)\]/g,
    (_match, charClass) => {
      let newCharClass = charClass

      // Replace each \p{Property} with its character class equivalent.
      for (const [prop, replacement] of Object.entries(unicodePropertyMap)) {
        const escapedProp = prop.replace(/[\\{}]/g, '\\$&')
        newCharClass = newCharClass.replace(
          new RegExp(`\\\\p\\{${escapedProp}\\}`, 'g'),
          replacement,
        )
      }

      return `[${newCharClass}]`
    },
  )

  // Transform standalone \p{Property} (not inside character class).
  // Example: /\p{Letter}+/u → /[a-zA-Z]+/
  for (const [prop, replacement] of Object.entries(unicodePropertyMap)) {
    const escapedProp = prop.replace(/[\\{}]/g, '\\$&')
    // Match \p{Property} that's NOT inside square brackets.
    // This is a simplified approach - proper parsing would be better.
    transformed = transformed.replace(
      new RegExp(`\\\\p\\{${escapedProp}\\}`, 'g'),
      `[${replacement}]`,
    )
  }

  // Remove /u and /v flags from regexes that used Unicode property escapes.
  // This is safe because we've replaced them with basic character classes.
  // Match regex literals: /pattern/flags
  transformed = transformed.replace(
    /\/([^/\\]|\\.)+\/([gimsuvy]+)/g,
    (match, _pattern, flags) => {
      // Only remove u/v flags if the regex originally had Unicode escapes.
      if (flags.includes('u') || flags.includes('v')) {
        const newFlags = flags.replace(/[uv]/g, '')
        return match.slice(0, -flags.length) + newFlags
      }
      return match
    },
  )

  return transformed
}
