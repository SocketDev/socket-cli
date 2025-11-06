/**
 * @fileoverview String manipulation utilities including ANSI code handling.
 * Provides string processing, prefix application, and terminal output utilities.
 */

import { ansiRegex, stripAnsi } from './ansi'
import { eastAsianWidth } from 'get-east-asian-width'
// Import get-east-asian-width from external wrapper.
// This library implements Unicode Standard Annex #11 (East Asian Width).
// https://www.unicode.org/reports/tr11/

// Re-export ANSI utilities for backward compatibility.
export { ansiRegex, stripAnsi }

// Type definitions
declare const BlankStringBrand: unique symbol
export type BlankString = string & { [BlankStringBrand]: true }
declare const EmptyStringBrand: unique symbol
export type EmptyString = string & { [EmptyStringBrand]: true }

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
export const fromCharCode = String.fromCharCode

export interface ApplyLinePrefixOptions {
  /**
   * The prefix to add to each line.
   * @default ''
   */
  prefix?: string | undefined
}

/**
 * Apply a prefix to each line of a string.
 *
 * Prepends the specified prefix to the beginning of each line in the input string.
 * If the string contains newlines, the prefix is added after each newline as well.
 * When no prefix is provided or prefix is empty, returns the original string unchanged.
 *
 * @param str - The string to add prefixes to
 * @param options - Configuration options
 * @returns The string with prefix applied to each line
 *
 * @example
 * ```ts
 * applyLinePrefix('hello\nworld', { prefix: '> ' })
 * // Returns: '> hello\n> world'
 *
 * applyLinePrefix('single line', { prefix: '  ' })
 * // Returns: '  single line'
 *
 * applyLinePrefix('no prefix')
 * // Returns: 'no prefix'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function applyLinePrefix(
  str: string,
  options?: ApplyLinePrefixOptions | undefined,
): string {
  const { prefix = '' } = {
    __proto__: null,
    ...options,
  } as ApplyLinePrefixOptions
  return prefix.length
    ? `${prefix}${str.includes('\n') ? str.replace(/\n/g, `\n${prefix}`) : str}`
    : str
}

/**
 * Convert a camelCase string to kebab-case.
 *
 * Transforms camelCase strings by converting uppercase letters to lowercase
 * and inserting hyphens before uppercase sequences. Handles consecutive
 * uppercase letters (like "XMLHttpRequest") by treating them as a single word.
 * Returns empty string for empty input.
 *
 * Note: This function only handles camelCase. For mixed formats including
 * snake_case, use `toKebabCase()` instead.
 *
 * @param str - The camelCase string to convert
 * @returns The kebab-case string
 *
 * @example
 * ```ts
 * camelToKebab('helloWorld')
 * // Returns: 'hello-world'
 *
 * camelToKebab('XMLHttpRequest')
 * // Returns: 'xmlhttprequest'
 *
 * camelToKebab('iOS')
 * // Returns: 'ios'
 *
 * camelToKebab('')
 * // Returns: ''
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function camelToKebab(str: string): string {
  const { length } = str
  if (!length) {
    return ''
  }
  let result = ''
  let i = 0
  while (i < length) {
    const char = str[i]
    if (!char) {
      break
    }
    const charCode = char.charCodeAt(0)
    // Check if current character is uppercase letter.
    // A = 65, Z = 90
    const isUpperCase = charCode >= 65 /*'A'*/ && charCode <= 90 /*'Z'*/
    if (isUpperCase) {
      // Add dash before uppercase sequence (except at start).
      if (result.length > 0) {
        result += '-'
      }
      // Collect all consecutive uppercase letters.
      while (i < length) {
        const currChar = str[i]
        if (!currChar) {
          break
        }
        const currCharCode = currChar.charCodeAt(0)
        const isCurrUpper =
          currCharCode >= 65 /*'A'*/ && currCharCode <= 90 /*'Z'*/
        if (isCurrUpper) {
          // Convert uppercase to lowercase: subtract 32 (A=65 -> a=97, diff=32)
          result += fromCharCode(currCharCode + 32 /*'a'-'A'*/)
          i += 1
        } else {
          // Stop when we hit non-uppercase.
          break
        }
      }
    } else {
      // Handle lowercase letters, digits, and other characters.
      result += char
      i += 1
    }
  }
  return result
}

export interface IndentStringOptions {
  /**
   * Number of spaces to indent each line.
   * @default 1
   */
  count?: number | undefined
}

/**
 * Indent each line of a string with spaces.
 *
 * Adds the specified number of spaces to the beginning of each non-empty line
 * in the input string. Empty lines (containing only whitespace) are not indented.
 * Uses a regular expression to efficiently handle multi-line strings.
 *
 * @param str - The string to indent
 * @param options - Configuration options
 * @returns The indented string
 *
 * @example
 * ```ts
 * indentString('hello\nworld', { count: 2 })
 * // Returns: '  hello\n  world'
 *
 * indentString('line1\n\nline3', { count: 4 })
 * // Returns: '    line1\n\n    line3'
 *
 * indentString('single line')
 * // Returns: ' single line' (default: 1 space)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function indentString(
  str: string,
  options?: IndentStringOptions | undefined,
): string {
  const { count = 1 } = { __proto__: null, ...options } as IndentStringOptions
  return str.replace(/^(?!\s*$)/gm, ' '.repeat(count))
}

/**
 * Check if a value is a blank string (empty or only whitespace).
 *
 * A blank string is defined as a string that is either:
 * - Completely empty (length 0)
 * - Contains only whitespace characters (spaces, tabs, newlines, etc.)
 *
 * This is useful for validation when you need to ensure user input
 * contains actual content, not just whitespace.
 *
 * @param value - The value to check
 * @returns `true` if the value is a blank string, `false` otherwise
 *
 * @example
 * ```ts
 * isBlankString('')
 * // Returns: true
 *
 * isBlankString('   ')
 * // Returns: true
 *
 * isBlankString('\n\t  ')
 * // Returns: true
 *
 * isBlankString('hello')
 * // Returns: false
 *
 * isBlankString(null)
 * // Returns: false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isBlankString(value: unknown): value is BlankString {
  return typeof value === 'string' && (!value.length || /^\s+$/.test(value))
}

/**
 * Check if a value is a non-empty string.
 *
 * Returns `true` only if the value is a string with at least one character.
 * This includes strings containing only whitespace (use `isBlankString()` if
 * you want to exclude those). Type guard ensures TypeScript knows the value
 * is a string after this check.
 *
 * @param value - The value to check
 * @returns `true` if the value is a non-empty string, `false` otherwise
 *
 * @example
 * ```ts
 * isNonEmptyString('hello')
 * // Returns: true
 *
 * isNonEmptyString('   ')
 * // Returns: true (contains whitespace)
 *
 * isNonEmptyString('')
 * // Returns: false
 *
 * isNonEmptyString(null)
 * // Returns: false
 *
 * isNonEmptyString(123)
 * // Returns: false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNonEmptyString(
  value: unknown,
): value is Exclude<string, EmptyString> {
  return typeof value === 'string' && value.length > 0
}

export interface SearchOptions {
  /**
   * The position in the string to begin searching from.
   * Negative values count back from the end of the string.
   * @default 0
   */
  fromIndex?: number | undefined
}

/**
 * Search for a regular expression in a string starting from an index.
 *
 * Similar to `String.prototype.search()` but allows specifying a starting
 * position. Returns the index of the first match at or after `fromIndex`,
 * or -1 if no match is found. Negative `fromIndex` values count back from
 * the end of the string.
 *
 * This is more efficient than using `str.slice(fromIndex).search()` when
 * you need the absolute position in the original string, as it handles
 * the offset calculation for you.
 *
 * @param str - The string to search in
 * @param regexp - The regular expression to search for
 * @param options - Configuration options
 * @returns The index of the first match, or -1 if not found
 *
 * @example
 * ```ts
 * search('hello world hello', /hello/, { fromIndex: 0 })
 * // Returns: 0 (first 'hello')
 *
 * search('hello world hello', /hello/, { fromIndex: 6 })
 * // Returns: 12 (second 'hello')
 *
 * search('hello world', /goodbye/, { fromIndex: 0 })
 * // Returns: -1 (not found)
 *
 * search('hello world', /hello/, { fromIndex: -5 })
 * // Returns: -1 (starts searching from 'world', no match)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function search(
  str: string,
  regexp: RegExp,
  options?: SearchOptions | undefined,
): number {
  const { fromIndex = 0 } = { __proto__: null, ...options } as SearchOptions
  const { length } = str
  if (fromIndex >= length) {
    return -1
  }
  if (fromIndex === 0) {
    return str.search(regexp)
  }
  const offset = fromIndex < 0 ? Math.max(length + fromIndex, 0) : fromIndex
  const result = str.slice(offset).search(regexp)
  return result === -1 ? -1 : result + offset
}

/**
 * Strip the Byte Order Mark (BOM) from the beginning of a string.
 *
 * The BOM (U+FEFF) is a Unicode character that can appear at the start of
 * a text file to indicate byte order and encoding. In UTF-16 (JavaScript's
 * internal string representation), it appears as 0xFEFF. This function
 * removes it if present, leaving the rest of the string unchanged.
 *
 * Most text processing doesn't need to handle the BOM explicitly, but it
 * can cause issues when parsing JSON, CSV, or other structured data formats
 * that don't expect a leading invisible character.
 *
 * @param str - The string to strip BOM from
 * @returns The string without BOM
 *
 * @example
 * ```ts
 * stripBom('\uFEFFhello world')
 * // Returns: 'hello world'
 *
 * stripBom('hello world')
 * // Returns: 'hello world' (no BOM to strip)
 *
 * stripBom('')
 * // Returns: ''
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function stripBom(str: string): string {
  // In JavaScript, string data is stored as UTF-16, so BOM is 0xFEFF.
  // https://tc39.es/ecma262/#sec-unicode-format-control-characters
  return str.length > 0 && str.charCodeAt(0) === 0xfe_ff ? str.slice(1) : str
}

// Initialize Intl.Segmenter for proper grapheme cluster segmentation.
// Hoisted outside stringWidth() for reuse across multiple calls.
//
// A grapheme cluster is what a user perceives as a single character, but may
// be composed of multiple Unicode code points.
//
// Why this matters:
// - '👍' (thumbs up) is 1 code point but appears as 1 character → 1 grapheme
// - '👍🏽' (thumbs up + skin tone) is 2 code points but appears as 1 character → 1 grapheme
// - '👨‍👩‍👧‍👦' (family) is 7 code points (4 people + 3 ZWJ) but appears as 1 character → 1 grapheme
// - 'é' can be 1 code point (U+00E9) OR 2 code points (e + ́) but appears as 1 character → 1 grapheme
//
// Without Intl.Segmenter, simple iteration treats each code point separately,
// leading to incorrect width calculations for complex sequences.
//
// Intl.Segmenter is available in:
// - Node.js 16.0.0+ (our minimum is 18.0.0, so always available)
// - All modern browsers
//
// Performance: Creating this once and reusing it is more efficient than
// creating a new Intl.Segmenter instance on every stringWidth() call.
const segmenter = new Intl.Segmenter()

// Feature-detect Unicode property escapes support and create regex patterns.
// Hoisted outside stringWidth() for reuse across multiple calls.
//
// Unicode property escapes in regex allow matching characters by their Unicode properties.
// The 'v' flag (ES2024, Node 20+) provides the most accurate Unicode support including:
// - \p{RGI_Emoji} - Matches only emoji recommended for general interchange
// - Full support for Unicode sets and properties
//
// The 'u' flag (ES2015, Node 18+) provides basic Unicode support but:
// - No \p{RGI_Emoji} property (must use broader \p{Extended_Pictographic})
// - No \p{Surrogate} property (must omit from patterns)
// - Less accurate for complex emoji sequences
//
// We feature-detect by attempting to create a regex with 'v' flag.
// If it throws, we fall back to 'u' flag with adjusted patterns.
//
// This ensures:
// - Best accuracy on Node 20+ (our test matrix: 20, 22, 24)
// - Backward compatibility with Node 18 (our minimum version)
// - No runtime errors from unsupported regex features
//
// Performance: Creating these once and reusing them is more efficient than
// creating new regex instances on every stringWidth() call.
let zeroWidthClusterRegex: RegExp
let leadingNonPrintingRegex: RegExp
let emojiRegex: RegExp

try {
  // Try 'v' flag first (Node 20+) for most accurate Unicode property support.
  //
  // ZERO-WIDTH CLUSTER PATTERN:
  // Matches entire clusters that should be invisible (width = 0):
  // - \p{Default_Ignorable_Code_Point} - Characters like Zero Width Space (U+200B)
  // - \p{Control} - ASCII control chars (0x00-0x1F, 0x7F-0x9F) like \t, \n
  // - \p{Mark} - Combining marks that modify previous character (accents, diacritics)
  // - \p{Surrogate} - Lone surrogate halves (invalid UTF-16, should not appear)
  zeroWidthClusterRegex =
    /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v

  // LEADING NON-PRINTING PATTERN:
  // Matches non-printing characters at the start of a cluster.
  // Used to find the "base" visible character in a cluster.
  // - \p{Format} - Formatting characters like Right-to-Left marks
  // Example: In a cluster starting with format chars, we skip them to find the base character.
  leadingNonPrintingRegex =
    /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v

  // RGI EMOJI PATTERN:
  // \p{RGI_Emoji} matches emoji in the "Recommended for General Interchange" set.
  // This is the most accurate way to detect emoji that should render as double-width.
  //
  // RGI emoji include:
  // - Basic emoji: 👍, 😀, ⚡
  // - Emoji with modifiers: 👍🏽 (thumbs up + medium skin tone)
  // - ZWJ sequences: 👨‍👩‍👧‍👦 (family: man, woman, girl, boy)
  // - Keycap sequences: 1️⃣ (digit + variation selector + combining enclosing keycap)
  //
  // Why RGI? The Unicode Consortium recommends this subset for interchange because:
  // - They have consistent rendering across platforms
  // - They're widely supported
  // - They follow a standardized format
  //
  // Non-RGI emoji might be symbols that look like emoji but render as 1 column.
  emojiRegex = /^\p{RGI_Emoji}$/v
} catch {
  // Fall back to 'u' flag (Node 18+) with slightly less accurate patterns.
  //
  // KEY DIFFERENCES from 'v' flag patterns:
  // 1. No \p{Surrogate} property - omitted from patterns
  // 2. No \p{RGI_Emoji} property - use \p{Extended_Pictographic} instead
  //
  // \p{Extended_Pictographic} is broader than \p{RGI_Emoji}:
  // - Includes emoji-like symbols that might render as 1 column
  // - Less precise but better than nothing
  // - Defined in Unicode Technical Standard #51
  //
  // The patterns are otherwise identical, just with \p{Surrogate} removed
  // and \p{RGI_Emoji} replaced with \p{Extended_Pictographic}.
  zeroWidthClusterRegex =
    /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark})+$/u
  leadingNonPrintingRegex =
    /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}]+/u
  emojiRegex = /^\p{Extended_Pictographic}$/u
}

/**
 * Get the visual width of a string in terminal columns.
 *
 * Calculates how many columns a string will occupy when displayed in a terminal,
 * accounting for:
 * - ANSI escape codes (stripped before calculation)
 * - Wide characters (CJK ideographs, fullwidth forms) that take 2 columns
 * - Emoji (including complex sequences) that take 2 columns
 * - Combining marks and zero-width characters (take 0 columns)
 * - East Asian Width properties (Fullwidth, Wide, Halfwidth, Narrow, etc.)
 *
 * Based on string-width by Sindre Sorhus:
 * https://socket.dev/npm/package/string-width/overview/7.2.0
 * MIT License
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 *
 * Terminal emulators display characters in a grid of cells (columns).
 * Most ASCII characters take 1 column, but some characters (especially
 * emoji and CJK characters) take 2 columns. This function calculates
 * the actual visual width, which is crucial for:
 * - Aligning text properly in tables or columns
 * - Preventing text from jumping when characters change
 * - Calculating padding/spacing for spinners and progress bars
 * - Wrapping text at the correct column width
 *
 * Algorithm Overview:
 * 1. Strip ANSI escape codes (invisible in terminal)
 * 2. Segment into grapheme clusters (user-perceived characters)
 * 3. For each cluster:
 *    - Skip zero-width/non-printing clusters (width = 0)
 *    - RGI emoji clusters are double-width (width = 2)
 *    - Otherwise use East Asian Width of first visible code point
 *    - Add width for trailing Halfwidth/Fullwidth Forms
 *
 * East Asian Width Categories (Unicode Standard Annex #11):
 * - F (Fullwidth): 2 columns - e.g., fullwidth Latin letters (Ａ, Ｂ)
 * - W (Wide): 2 columns - e.g., CJK ideographs (漢字), emoji (⚡, 😀)
 * - H (Halfwidth): 1 column - e.g., halfwidth Katakana (ｱ, ｲ)
 * - Na (Narrow): 1 column - e.g., ASCII (a-z, 0-9)
 * - A (Ambiguous): Context-dependent, treated as 1 column by default
 * - N (Neutral): 1 column - e.g., most symbols (✦, ✧, ⋆)
 *
 * Why This Matters for Socket:
 * - Lightning bolt (⚡) takes 2 columns
 * - Stars (✦, ✧, ⋆) take 1 column
 * - Without proper width calculation, spinner text jumps between frames
 * - This function enables consistent alignment by calculating padding
 *
 * @param text - The string to measure
 * @returns The visual width in terminal columns
 *
 * @example
 * ```ts
 * stringWidth('hello')
 * // Returns: 5 (5 ASCII chars = 5 columns)
 *
 * stringWidth('⚡')
 * // Returns: 2 (lightning bolt is wide)
 *
 * stringWidth('✦')
 * // Returns: 1 (star is narrow)
 *
 * stringWidth('漢字')
 * // Returns: 4 (2 CJK characters × 2 columns each)
 *
 * stringWidth('\x1b[31mred\x1b[0m')
 * // Returns: 3 (ANSI codes stripped, 'red' = 3)
 *
 * stringWidth('👍🏽')
 * // Returns: 2 (emoji with skin tone = 1 grapheme cluster = 2 columns)
 *
 * stringWidth('é')
 * // Returns: 1 (combining accent doesn't add width)
 *
 * stringWidth('')
 * // Returns: 0
 * ```
 *
 * @throws {TypeError} When input is not a string
 */
/*@__NO_SIDE_EFFECTS__*/
export function stringWidth(text: string): number {
  if (typeof text !== 'string' || !text.length) {
    return 0
  }

  // Strip ANSI escape codes first (colors, bold, italic, etc.).
  // These are invisible and don't contribute to visual width.
  // Example: '\x1b[31mred\x1b[0m' becomes 'red'.
  const plainText = stripAnsi(text)

  if (!plainText.length) {
    return 0
  }

  // KEY IMPROVEMENT #1: Proper Grapheme Cluster Segmentation
  //
  // Use the hoisted Intl.Segmenter instance (defined outside this function).
  // See comments above for detailed explanation of grapheme cluster segmentation.

  // KEY IMPROVEMENT #2: Feature Detection for Unicode Property Escapes
  //
  // Use the hoisted regex patterns (defined outside this function).
  // See comments above for detailed explanation of feature detection and fallback patterns.

  let width = 0

  // Configure East Asian Width calculation.
  // ambiguousAsWide: false - treat ambiguous-width characters as narrow (1 column).
  //
  // Ambiguous width characters (category 'A') include:
  // - Greek letters: α, β, γ
  // - Cyrillic letters: А, Б, В
  // - Box drawing characters: ─, │, ┌
  //
  // In East Asian contexts, these are often rendered as wide (2 columns).
  // In Western contexts, they're typically narrow (1 column).
  //
  // We choose narrow (false) because:
  // - Socket's primary audience is Western developers
  // - Most terminal emulators default to narrow for ambiguous characters
  // - Consistent with string-width's default behavior
  const eastAsianWidthOptions = { ambiguousAsWide: false }

  // KEY IMPROVEMENT #3: Comprehensive Width Calculation
  //
  // Segment the string into grapheme clusters and calculate width for each.
  // This is the core algorithm that handles all the complexity of Unicode text rendering.
  for (const { segment } of segmenter.segment(plainText)) {
    // STEP 1: Skip zero-width / non-printing clusters
    //
    // These clusters contain only invisible characters that take no space.
    // Examples:
    // - '\t' (tab) - Control character
    // - '\n' (newline) - Control character
    // - '\u200B' (zero-width space) - Default ignorable
    // - Combining marks without base character
    //
    // Why skip? Terminals don't allocate columns for these characters.
    // They're either control codes or modify adjacent characters without adding width.
    if (zeroWidthClusterRegex.test(segment)) {
      continue
    }

    // STEP 2: Handle emoji (double-width)
    //
    // RGI emoji are always rendered as double-width (2 columns) in terminals.
    // This is true even for complex sequences:
    // - 👍 (basic emoji) = 2 columns
    // - 👍🏽 (emoji + skin tone modifier) = 2 columns (not 4!)
    // - 👨‍👩‍👧‍👦 (family ZWJ sequence) = 2 columns (not 14!)
    //
    // Why double-width? Historical reasons:
    // - Emoji originated in Japanese mobile carriers
    // - They were designed to match CJK character width
    // - Terminal emulators inherited this behavior
    //
    // The key insight: The ENTIRE grapheme cluster is 2 columns, regardless
    // of how many code points it contains. That's why we need Intl.Segmenter!
    if (emojiRegex.test(segment)) {
      width += 2
      continue
    }

    // STEP 3: Use East Asian Width for everything else
    //
    // For non-emoji clusters, calculate width based on the first visible character.
    //
    // Why first visible character? In a grapheme cluster like "é" (e + combining acute),
    // the base character 'e' determines the width, and the combining mark modifies it
    // without adding width.
    //
    // Strip leading non-printing characters to find the base character.
    // Example: If a cluster starts with format characters, skip them to find
    // the actual visible character that determines width.
    const baseSegment = segment.replace(leadingNonPrintingRegex, '')
    const codePoint = baseSegment.codePointAt(0)

    if (codePoint === undefined) {
      // If no visible character remains after stripping non-printing chars, skip.
      // This shouldn't happen if our zero-width regex is correct, but defensive programming.
      continue
    }

    // Calculate width using East Asian Width property.
    // This handles:
    // - Narrow (1 column): ASCII a-z, A-Z, 0-9, most symbols
    // - Wide (2 columns): CJK ideographs (漢, 字), fullwidth forms (Ａ, Ｂ)
    // - Halfwidth (1 column): Halfwidth Katakana (ｱ, ｲ, ｳ)
    // - Ambiguous (1 column per our config): Greek, Cyrillic, box drawing
    width += eastAsianWidth(codePoint, eastAsianWidthOptions)

    // STEP 4: Handle trailing Halfwidth and Fullwidth Forms
    //
    // The Halfwidth and Fullwidth Forms Unicode block (U+FF00-U+FFEF) contains
    // compatibility characters for legacy East Asian encodings.
    //
    // Examples:
    // - ﾞ (U+FF9E) - Halfwidth Katakana voiced sound mark (dakuten)
    // - ﾟ (U+FF9F) - Halfwidth Katakana semi-voiced sound mark (handakuten)
    // - ｰ (U+FF70) - Halfwidth Katakana-Hiragana prolonged sound mark
    //
    // These can appear as TRAILING characters in a grapheme cluster (not leading).
    // When they do, they add their own width to the cluster.
    //
    // Example: A cluster might be [base character][dakuten]
    // - Base character contributes its width (calculated above)
    // - Dakuten contributes its width (calculated here)
    //
    // Why is this necessary? These forms are spacing characters, not combining marks.
    // They occupy their own column(s) even when following another character.
    //
    // Note: We only check trailing characters (segment.slice(1)).
    // The base character width was already calculated above.
    if (segment.length > 1) {
      for (const char of segment.slice(1)) {
        const charCode = char.charCodeAt(0)
        // Check if character is in Halfwidth and Fullwidth Forms range.
        if (charCode >= 0xff_00 && charCode <= 0xff_ef) {
          const trailingCodePoint = char.codePointAt(0)
          if (trailingCodePoint !== undefined) {
            // Add the East Asian Width of this trailing character.
            // Most halfwidth forms contribute 1 column, fullwidth contribute 2.
            width += eastAsianWidth(trailingCodePoint, eastAsianWidthOptions)
          }
        }
      }
    }
  }

  return width
}

/**
 * Convert a string to kebab-case (handles camelCase and snake_case).
 *
 * Transforms strings from camelCase or snake_case to kebab-case by:
 * - Converting uppercase letters to lowercase
 * - Inserting hyphens before uppercase letters (for camelCase)
 * - Replacing underscores with hyphens (for snake_case)
 *
 * This is more comprehensive than `camelToKebab()` as it handles mixed
 * formats including snake_case. Returns empty string for empty input.
 *
 * @param str - The string to convert
 * @returns The kebab-case string
 *
 * @example
 * ```ts
 * toKebabCase('helloWorld')
 * // Returns: 'hello-world'
 *
 * toKebabCase('hello_world')
 * // Returns: 'hello-world'
 *
 * toKebabCase('XMLHttpRequest')
 * // Returns: 'xmlhttp-request'
 *
 * toKebabCase('iOS_Version')
 * // Returns: 'io-s-version'
 *
 * toKebabCase('')
 * // Returns: ''
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function toKebabCase(str: string): string {
  if (!str.length) {
    return str
  }
  return (
    str
      // Convert camelCase to kebab-case
      .replace(/([a-z]+[0-9]*)([A-Z])/g, '$1-$2')
      // Convert underscores to hyphens
      .replace(/_/g, '-')
      .toLowerCase()
  )
}

/**
 * Trim newlines from the beginning and end of a string.
 *
 * Removes all leading and trailing newline characters (both `\n` and `\r`)
 * from a string, while preserving any newlines in the middle. This is similar
 * to `String.prototype.trim()` but specifically targets newlines instead of
 * all whitespace.
 *
 * Optimized for performance by checking the first and last characters before
 * doing any string manipulation. Returns the original string unchanged if no
 * newlines are found at the edges.
 *
 * @param str - The string to trim
 * @returns The string with leading and trailing newlines removed
 *
 * @example
 * ```ts
 * trimNewlines('\n\nhello\n\n')
 * // Returns: 'hello'
 *
 * trimNewlines('\r\nworld\r\n')
 * // Returns: 'world'
 *
 * trimNewlines('hello\nworld')
 * // Returns: 'hello\nworld' (middle newline preserved)
 *
 * trimNewlines('  hello  ')
 * // Returns: '  hello  ' (spaces not trimmed, only newlines)
 *
 * trimNewlines('hello')
 * // Returns: 'hello'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function trimNewlines(str: string): string {
  const { length } = str
  if (length === 0) {
    return str
  }
  const first = str.charCodeAt(0)
  const noFirstNewline = first !== 13 /*'\r'*/ && first !== 10 /*'\n'*/
  if (length === 1) {
    return noFirstNewline ? str : ''
  }
  const last = str.charCodeAt(length - 1)
  const noLastNewline = last !== 13 /*'\r'*/ && last !== 10 /*'\n'*/
  if (noFirstNewline && noLastNewline) {
    return str
  }
  let start = 0
  let end = length
  while (start < end) {
    const code = str.charCodeAt(start)
    if (code !== 13 /*'\r'*/ && code !== 10 /*'\n'*/) {
      break
    }
    start += 1
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1)
    if (code !== 13 /*'\r'*/ && code !== 10 /*'\n'*/) {
      break
    }
    end -= 1
  }
  return start === 0 && end === length ? str : str.slice(start, end)
}

/**
 * Repeat a string n times.
 *
 * Creates a new string by repeating the input string the specified number of times.
 * Returns an empty string if count is zero or negative. This is a simple wrapper
 * around `String.prototype.repeat()` with guard for non-positive counts.
 *
 * @param str - The string to repeat
 * @param count - The number of times to repeat the string
 * @returns The repeated string, or empty string if count <= 0
 *
 * @example
 * ```ts
 * repeatString('hello', 3)
 * // Returns: 'hellohellohello'
 *
 * repeatString('x', 5)
 * // Returns: 'xxxxx'
 *
 * repeatString('hello', 0)
 * // Returns: ''
 *
 * repeatString('hello', -1)
 * // Returns: ''
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function repeatString(str: string, count: number): string {
  if (count <= 0) {
    return ''
  }
  return str.repeat(count)
}

/**
 * Center text within a given width.
 *
 * Adds spaces before and after the text to center it within the specified width.
 * Distributes padding evenly on both sides. When the padding is odd, the extra
 * space is added to the right side. Strips ANSI codes before calculating text
 * length to ensure accurate centering of colored text.
 *
 * If the text is already wider than or equal to the target width, returns the
 * original text unchanged (no truncation occurs).
 *
 * @param text - The text to center (may include ANSI codes)
 * @param width - The target width in columns
 * @returns The centered text with padding
 *
 * @example
 * ```ts
 * centerText('hello', 11)
 * // Returns: '   hello   ' (3 spaces on each side)
 *
 * centerText('hi', 10)
 * // Returns: '    hi    ' (4 spaces on each side)
 *
 * centerText('odd', 8)
 * // Returns: '  odd   ' (2 left, 3 right)
 *
 * centerText('\x1b[31mred\x1b[0m', 7)
 * // Returns: '  \x1b[31mred\x1b[0m  ' (ANSI codes preserved, 'red' centered)
 *
 * centerText('too long text', 5)
 * // Returns: 'too long text' (no truncation, returned as-is)
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function centerText(text: string, width: number): string {
  const textLength = stripAnsi(text).length
  if (textLength >= width) {
    return text
  }

  const padding = width - textLength
  const leftPad = Math.floor(padding / 2)
  const rightPad = padding - leftPad

  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad)
}
