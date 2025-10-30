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
 * Map of Unicode property escapes to explicit character ranges.
 * These are used when Node.js is built without ICU support (--with-intl=none).
 * Based on ECMAScript Unicode property escapes specification:
 * https://tc39.es/ecma262/#table-binary-unicode-properties
 * https://tc39.es/ecma262/#table-binary-unicode-properties-of-strings
 */
export const unicodePropertyMap = {
  __proto__: null,

  // Special properties.
  'Default_Ignorable_Code_Point': '\\u00AD\\u034F\\u061C\\u115F-\\u1160\\u17B4-\\u17B5\\u180B-\\u180D\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFF8',
  'ASCII': '\\x00-\\x7F',
  'ASCII_Hex_Digit': '0-9A-Fa-f',
  'Alphabetic': 'A-Za-z\\u00AA\\u00B5\\u00BA\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE',

  // General categories - Letter.
  'Letter': 'A-Za-z\\u00AA\\u00B5\\u00BA\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE',
  'L': 'A-Za-z\\u00AA\\u00B5\\u00BA\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE',
  'Lowercase_Letter': 'a-z\\u00B5\\u00DF-\\u00F6\\u00F8-\\u00FF',
  'Ll': 'a-z\\u00B5\\u00DF-\\u00F6\\u00F8-\\u00FF',
  'Uppercase_Letter': 'A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE',
  'Lu': 'A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE',
  'Titlecase_Letter': '\\u01C5\\u01C8\\u01CB\\u01F2',
  'Lt': '\\u01C5\\u01C8\\u01CB\\u01F2',
  'Modifier_Letter': '\\u02B0-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE',
  'Lm': '\\u02B0-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE',
  'Other_Letter': '\\u00AA\\u00BA',
  'Lo': '\\u00AA\\u00BA',

  // General categories - Mark.
  'Mark': '\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06DC\\u06DF-\\u06E4\\u06E7-\\u06E8\\u06EA-\\u06ED',
  'M': '\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06DC\\u06DF-\\u06E4\\u06E7-\\u06E8\\u06EA-\\u06ED',
  'Nonspacing_Mark': '\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7',
  'Mn': '\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7',
  'Spacing_Mark': '\\u0903\\u093B\\u093E-\\u0940\\u0949-\\u094C\\u094E-\\u094F',
  'Mc': '\\u0903\\u093B\\u093E-\\u0940\\u0949-\\u094C\\u094E-\\u094F',
  'Enclosing_Mark': '\\u0488-\\u0489',
  'Me': '\\u0488-\\u0489',

  // General categories - Number.
  'Number': '0-9\\u00B2-\\u00B3\\u00B9\\u00BC-\\u00BE',
  'N': '0-9\\u00B2-\\u00B3\\u00B9\\u00BC-\\u00BE',
  'Decimal_Number': '0-9',
  'Nd': '0-9',
  'Letter_Number': '\\u16EE-\\u16F0\\u2160-\\u2182\\u2185-\\u2188\\u3007\\u3021-\\u3029\\u3038-\\u303A',
  'Nl': '\\u16EE-\\u16F0\\u2160-\\u2182\\u2185-\\u2188\\u3007\\u3021-\\u3029\\u3038-\\u303A',
  'Other_Number': '\\u00B2-\\u00B3\\u00B9\\u00BC-\\u00BE',
  'No': '\\u00B2-\\u00B3\\u00B9\\u00BC-\\u00BE',

  // General categories - Punctuation.
  'Punctuation': '!-#%-\\*,-\\/:;\\?@\\[-\\]_\\{\\}\\u00A1\\u00A7\\u00AB\\u00B6-\\u00B7\\u00BB\\u00BF',
  'P': '!-#%-\\*,-\\/:;\\?@\\[-\\]_\\{\\}\\u00A1\\u00A7\\u00AB\\u00B6-\\u00B7\\u00BB\\u00BF',
  'Connector_Punctuation': '_\\u203F-\\u2040',
  'Pc': '_\\u203F-\\u2040',
  'Dash_Punctuation': '\\-\\u2010-\\u2015',
  'Pd': '\\-\\u2010-\\u2015',
  'Open_Punctuation': '\\(\\[\\{',
  'Ps': '\\(\\[\\{',
  'Close_Punctuation': '\\)\\]\\}',
  'Pe': '\\)\\]\\}',
  'Initial_Punctuation': '\\u00AB',
  'Pi': '\\u00AB',
  'Final_Punctuation': '\\u00BB',
  'Pf': '\\u00BB',
  'Other_Punctuation': '!-#%-\\*,\\.\\/:;\\?@\\\\\\u00A1\\u00A7\\u00B6-\\u00B7\\u00BF',
  'Po': '!-#%-\\*,\\.\\/:;\\?@\\\\\\u00A1\\u00A7\\u00B6-\\u00B7\\u00BF',

  // General categories - Symbol.
  'Symbol': '\\$\\+<->\\^`\\|~\\u00A2-\\u00A6\\u00A8-\\u00A9\\u00AC\\u00AE-\\u00B1\\u00B4\\u00B8\\u00D7\\u00F7',
  'S': '\\$\\+<->\\^`\\|~\\u00A2-\\u00A6\\u00A8-\\u00A9\\u00AC\\u00AE-\\u00B1\\u00B4\\u00B8\\u00D7\\u00F7',
  'Math_Symbol': '\\+<->\\|~\\u00AC\\u00B1\\u00D7\\u00F7',
  'Sm': '\\+<->\\|~\\u00AC\\u00B1\\u00D7\\u00F7',
  'Currency_Symbol': '\\$\\u00A2-\\u00A5',
  'Sc': '\\$\\u00A2-\\u00A5',
  'Modifier_Symbol': '\\^`\\u00A8\\u00AF\\u00B4\\u00B8',
  'Sk': '\\^`\\u00A8\\u00AF\\u00B4\\u00B8',
  'Other_Symbol': '\\u00A6\\u00A9\\u00AE\\u00B0',
  'So': '\\u00A6\\u00A9\\u00AE\\u00B0',

  // General categories - Separator.
  'Separator': ' \\u00A0\\u1680\\u2000-\\u200A\\u2028-\\u2029\\u202F\\u205F\\u3000',
  'Z': ' \\u00A0\\u1680\\u2000-\\u200A\\u2028-\\u2029\\u202F\\u205F\\u3000',
  'Space_Separator': ' \\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000',
  'Zs': ' \\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000',
  'Line_Separator': '\\u2028',
  'Zl': '\\u2028',
  'Paragraph_Separator': '\\u2029',
  'Zp': '\\u2029',

  // General categories - Other.
  'Other': '\\x00-\\x1F\\x7F-\\x9F\\u00AD',
  'C': '\\x00-\\x1F\\x7F-\\x9F\\u00AD',
  'Control': '\\x00-\\x1F\\x7F-\\x9F',
  'Cc': '\\x00-\\x1F\\x7F-\\x9F',
  'Format': '\\u00AD\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u08E2\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB',
  'Cf': '\\u00AD\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u08E2\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB',
  'Surrogate': '\\uD800-\\uDFFF',
  'Cs': '\\uD800-\\uDFFF',
  'Private_Use': '\\uE000-\\uF8FF',
  'Co': '\\uE000-\\uF8FF',
  'Unassigned': '\\u0378-\\u0379\\u0380-\\u0383\\u038B\\u038D\\u03A2',
  'Cn': '\\u0378-\\u0379\\u0380-\\u0383\\u038B\\u038D\\u03A2',

  // Emoji properties.
  'Extended_Pictographic': '\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u2199\\u21A9-\\u21AA\\u231A-\\u231B\\u2328\\u23CF\\u23E9-\\u23F3\\u23F8-\\u23FA\\u24C2\\u25AA-\\u25AB\\u25B6\\u25C0\\u25FB-\\u25FE\\u2600-\\u2604\\u260E\\u2611\\u2614-\\u2615\\u2618\\u261D\\u2620\\u2622-\\u2623\\u2626\\u262A\\u262E-\\u262F\\u2638-\\u263A\\u2640\\u2642\\u2648-\\u2653\\u265F-\\u2660\\u2663\\u2665-\\u2666\\u2668\\u267B\\u267E-\\u267F\\u2692-\\u2697\\u2699\\u269B-\\u269C\\u26A0-\\u26A1\\u26A7\\u26AA-\\u26AB\\u26B0-\\u26B1\\u26BD-\\u26BE\\u26C4-\\u26C5\\u26C8\\u26CE-\\u26CF\\u26D1\\u26D3-\\u26D4\\u26E9-\\u26EA\\u26F0-\\u26F5\\u26F7-\\u26FA\\u26FD\\u2702\\u2705\\u2708-\\u270D\\u270F\\u2712\\u2714\\u2716\\u271D\\u2721\\u2728\\u2733-\\u2734\\u2744\\u2747\\u274C\\u274E\\u2753-\\u2755\\u2757\\u2763-\\u2764\\u2795-\\u2797\\u27A1\\u27B0\\u27BF\\u2934-\\u2935\\u2B05-\\u2B07\\u2B1B-\\u2B1C\\u2B50\\u2B55\\u3030\\u303D\\u3297\\u3299',
  'RGI_Emoji': '\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u2199\\u21A9-\\u21AA\\u231A-\\u231B\\u2328\\u23CF\\u23E9-\\u23F3\\u23F8-\\u23FA\\u24C2\\u25AA-\\u25AB\\u25B6\\u25C0\\u25FB-\\u25FE\\u2600-\\u2604\\u260E\\u2611\\u2614-\\u2615\\u2618\\u261D\\u2620\\u2622-\\u2623\\u2626\\u262A\\u262E-\\u262F\\u2638-\\u263A\\u2640\\u2642\\u2648-\\u2653\\u265F-\\u2660\\u2663\\u2665-\\u2666\\u2668\\u267B\\u267E-\\u267F\\u2692-\\u2697\\u2699\\u269B-\\u269C\\u26A0-\\u26A1\\u26A7\\u26AA-\\u26AB\\u26B0-\\u26B1\\u26BD-\\u26BE\\u26C4-\\u26C5\\u26C8\\u26CE-\\u26CF\\u26D1\\u26D3-\\u26D4\\u26E9-\\u26EA\\u26F0-\\u26F5\\u26F7-\\u26FA\\u26FD\\u2702\\u2705\\u2708-\\u270D\\u270F\\u2712\\u2714\\u2716\\u271D\\u2721\\u2728\\u2733-\\u2734\\u2744\\u2747\\u274C\\u274E\\u2753-\\u2755\\u2757\\u2763-\\u2764\\u2795-\\u2797\\u27A1\\u27B0\\u27BF\\u2934-\\u2935\\u2B05-\\u2B07\\u2B1B-\\u2B1C\\u2B50\\u2B55\\u3030\\u303D\\u3297\\u3299',
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

    NewExpression(path) {
      const { node } = path

      // Check if this is a RegExp constructor.
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'RegExp') {
        return
      }

      // Must have at least 2 arguments (pattern, flags).
      if (!node.arguments || node.arguments.length < 2) {
        return
      }

      const patternArg = node.arguments[0]
      const flagsArg = node.arguments[1]

      // Both arguments must be string literals.
      if (patternArg.type !== 'StringLiteral' || flagsArg.type !== 'StringLiteral') {
        return
      }

      const pattern = patternArg.value
      const flags = flagsArg.value

      // Check if this regex has u or v flags.
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
        // Replace with no-op regex: new RegExp('(?:)', '').
        s.overwrite(node.start, node.end, 'new RegExp("(?:)", "")')
        return
      }

      // If pattern changed or flags need to be removed.
      if (transformedPattern !== pattern || hasUFlag || hasVFlag) {
        // Remove u and v flags.
        const newFlags = flags.replace(/[uv]/g, '')

        // Determine quote character from original code.
        const patternQuote = content[patternArg.start]
        const flagsQuote = content[flagsArg.start]

        // Replace pattern.
        s.overwrite(patternArg.start, patternArg.end, `${patternQuote}${transformedPattern}${patternQuote}`)

        // Replace flags.
        s.overwrite(flagsArg.start, flagsArg.end, `${flagsQuote}${newFlags}${flagsQuote}`)
      }
    },
  })

  return s.toString()
}
