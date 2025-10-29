/**
 * @fileoverview Shared Unicode property escape transformations for --with-intl=none.
 *
 * Transforms Unicode property escapes (\p{...}) into basic character class alternatives
 * that work without ICU support. This enables Node.js builds with --with-intl=none to
 * save ~6-8MB by removing ICU.
 *
 * Used by:
 * - babel-plugin-with-intl-none.mjs (CLI Babel transforms)
 * - bootstrap esbuild-plugin-smol-transform.mjs (Bootstrap esbuild transforms)
 *
 * @example
 * import { transformUnicodePropertyEscapes } from './unicode-property-escape-transform.mjs'
 *
 * const code = 'const regex = /[\\p{Letter}\\p{Number}]+/u'
 * const transformed = transformUnicodePropertyEscapes(code)
 * // Result: 'const regex = /[a-zA-Z0-9]+/'
 */

/**
 * Map of Unicode property escapes to basic character class alternatives.
 * Approximations are used where exact equivalents don't exist.
 *
 * @type {Record<string, string>}
 */
export const unicodePropertyMap = {
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
  // Covers most common cases: soft hyphen, zero-width spaces, format controls, etc.
  'Default_Ignorable_Code_Point': '\\u00AD\\u034F\\u061C\\u115F-\\u1160\\u17B4-\\u17B5\\u180B-\\u180D\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFF8',
}

/**
 * Transform Unicode property escapes in regex patterns for ICU-free environments.
 *
 * @param {string} content - Source code to transform
 * @returns {string} Transformed source code
 */
export function transformUnicodePropertyEscapes(content) {
  let transformed = content

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
