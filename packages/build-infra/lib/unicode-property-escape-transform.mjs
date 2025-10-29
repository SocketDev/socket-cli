/**
 * @fileoverview Transform Unicode property escapes for --with-intl=none compatibility.
 *
 * This module provides transformations to convert Unicode property escapes
 * (\p{Property}) into basic character class equivalents that work without ICU support.
 */

import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import MagicString from 'magic-string'

// Handle CommonJS default export.
const traverse = traverseModule.default || traverseModule

/**
 * Map of Unicode property escapes to basic character class alternatives.
 */
export const unicodePropertyMap = {
  __proto__: null,
  // Letter categories.
  'Alphabetic': 'a-zA-Z',
  'Alpha': 'a-zA-Z',
  'L': 'a-zA-Z',
  'Letter': 'a-zA-Z',
  // Number categories.
  'Digit': '0-9',
  'N': '0-9',
  'Nd': '0-9',
  'Number': '0-9',
  // Whitespace.
  'Space': '\\s',
  'White_Space': '\\s',
  // ASCII range.
  'ASCII': '\\x00-\\x7F',
  // Control characters (basic approximation).
  'Cc': '\\x00-\\x1F\\x7F-\\x9F',
  'Control': '\\x00-\\x1F\\x7F-\\x9F',
  // Format characters (approximate with zero-width space).
  'Cf': '\\u200B-\\u200D\\uFEFF',
  'Format': '\\u200B-\\u200D\\uFEFF',
  // Mark categories (combining marks - approximate).
  'M': '\\u0300-\\u036F',
  'Mark': '\\u0300-\\u036F',
  // Default_Ignorable_Code_Point (approximate with common invisibles).
  'Default_Ignorable_Code_Point': '\\u00AD\\u034F\\u061C\\u115F-\\u1160\\u17B4-\\u17B5\\u180B-\\u180D\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFF8',
}

/**
 * Check if a regex pattern has unsupported Unicode features.
 */
function hasUnsupportedUnicodeFeatures(pattern) {
  // Check for \u{} escapes (require /u flag).
  if (/\\u\{[0-9a-fA-F]+\}/.test(pattern)) {
    return true
  }
  // Check for remaining \p{} or \P{} escapes that we don't support.
  if (/\\[pP]\{/.test(pattern)) {
    return true
  }
  return false
}

/**
 * Transform a regex pattern by replacing \p{Property} with character classes.
 */
function transformRegexPattern(pattern) {
  let transformed = pattern

  // Replace \p{Property} with character class equivalents.
  for (const [prop, replacement] of Object.entries(unicodePropertyMap)) {
    const escapedProp = prop.replace(/[\\{}]/g, '\\$&')
    // Replace \p{Property} with [replacement].
    transformed = transformed.replace(
      new RegExp(`\\\\p\\{${escapedProp}\\}`, 'g'),
      `[${replacement}]`,
    )
  }

  return transformed
}

/**
 * Transform Unicode property escapes in regex patterns for ICU-free environments.
 *
 * Uses Babel AST parsing to properly identify regex literals and transform them.
 *
 * @param {string} content - Source code to transform
 * @returns {string} Transformed source code
 */
export function transformUnicodePropertyEscapes(content) {
  let ast
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: [],
    })
  } catch (e) {
    // If parsing fails, return content unchanged.
    console.warn('Failed to parse code for Unicode transform:', e.message)
    return content
  }

  const s = new MagicString(content)

  traverse(ast, {
    RegExpLiteral(path) {
      const { node } = path
      const { pattern, flags } = node
      const { start, end } = node

      // Check if this regex has /u or /v flags.
      const hasUFlag = flags.includes('u')
      const hasVFlag = flags.includes('v')

      if (!hasUFlag && !hasVFlag) {
        // No Unicode flags, nothing to transform.
        return
      }

      // Transform the pattern.
      const transformedPattern = transformRegexPattern(pattern)

      // Check if transformed pattern still has unsupported Unicode features.
      if (hasUnsupportedUnicodeFeatures(transformedPattern)) {
        // Replace entire regex with /(?:)/ (no-op regex).
        s.overwrite(start, end, '/(?:)/')
        return
      }

      // If pattern changed, update it and remove Unicode flags.
      if (transformedPattern !== pattern) {
        // Remove /u and /v flags.
        const newFlags = flags.replace(/[uv]/g, '')
        const newRegex = `/${transformedPattern}/${newFlags}`
        s.overwrite(start, end, newRegex)
        return
      }

      // Pattern unchanged but has Unicode flags - check if safe to remove flags.
      // Only remove flags if pattern has no \u{} escapes or other Unicode-specific syntax.
      if (!hasUnsupportedUnicodeFeatures(pattern)) {
        // Safe to remove Unicode flags.
        const newFlags = flags.replace(/[uv]/g, '')
        const newRegex = `/${pattern}/${newFlags}`
        s.overwrite(start, end, newRegex)
      } else {
        // Has unsupported features, replace with no-op.
        s.overwrite(start, end, '/(?:)/')
      }
    },
  })

  return s.toString()
}
