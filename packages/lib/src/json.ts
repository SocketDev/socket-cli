/**
 * @fileoverview JSON parsing utilities with Buffer detection and BOM stripping.
 * Provides safe JSON parsing with automatic encoding handling.
 */

import { stripBom } from './strings'

/**
 * JSON primitive types: `null`, `boolean`, `number`, or `string`.
 *
 * @example
 * ```ts
 * const primitives: JsonPrimitive[] = [null, true, 42, 'hello']
 * ```
 */
export type JsonPrimitive = null | boolean | number | string

/**
 * Any valid JSON value: primitive, object, or array.
 *
 * @example
 * ```ts
 * const values: JsonValue[] = [
 *   null,
 *   true,
 *   42,
 *   'hello',
 *   { key: 'value' },
 *   [1, 2, 3]
 * ]
 * ```
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

/**
 * A JSON object with string keys and JSON values.
 *
 * @example
 * ```ts
 * const obj: JsonObject = {
 *   name: 'example',
 *   count: 42,
 *   active: true,
 *   nested: { key: 'value' }
 * }
 * ```
 */
export interface JsonObject {
  [key: string]: JsonValue
}

/**
 * A JSON array containing JSON values.
 *
 * @example
 * ```ts
 * const arr: JsonArray = [1, 'two', { three: 3 }, [4, 5]]
 * ```
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * Reviver function for transforming parsed JSON values.
 * Called for each key-value pair during parsing.
 *
 * @param key - The object key or array index being parsed
 * @param value - The parsed value
 * @returns The transformed value (or original if no transform needed)
 *
 * @example
 * ```ts
 * // Convert date strings to Date objects
 * const reviver: JsonReviver = (key, value) => {
 *   if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
 *     return new Date(value)
 *   }
 *   return value
 * }
 * ```
 */
export type JsonReviver = (key: string, value: unknown) => unknown

/**
 * Options for JSON parsing operations.
 */
export interface JsonParseOptions {
  /**
   * Optional filepath for improved error messages.
   * When provided, errors will be prefixed with the filepath.
   *
   * @example
   * ```ts
   * // Error message will be: "config.json: Unexpected token } in JSON"
   * jsonParse('invalid', { filepath: 'config.json' })
   * ```
   */
  filepath?: string | undefined
  /**
   * Optional reviver function to transform parsed values.
   * Called for each key-value pair during parsing.
   *
   * @example
   * ```ts
   * // Convert ISO date strings to Date objects
   * const options = {
   *   reviver: (key, value) => {
   *     if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
   *       return new Date(value)
   *     }
   *     return value
   *   }
   * }
   * ```
   */
  reviver?: JsonReviver | undefined
  /**
   * Whether to throw on parse errors.
   * When `false`, returns `undefined` instead of throwing.
   *
   * @default true
   *
   * @example
   * ```ts
   * // Throws error
   * jsonParse('invalid', { throws: true })
   *
   * // Returns undefined
   * const result = jsonParse('invalid', { throws: false })
   * ```
   */
  throws?: boolean | undefined
}

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const JSONParse = JSON.parse

/**
 * Check if a value is a Buffer instance.
 * Uses duck-typing to detect Buffer without requiring Node.js Buffer in type system.
 *
 * @param x - Value to check
 * @returns `true` if value is a Buffer, `false` otherwise
 *
 * @example
 * ```ts
 * isBuffer(Buffer.from('hello')) // => true
 * isBuffer('hello') // => false
 * isBuffer({ length: 5 }) // => false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
function isBuffer(x: unknown): x is Buffer {
  if (!x || typeof x !== 'object') {
    return false
  }
  const obj = x as Record<string | number, unknown>
  if (typeof obj['length'] !== 'number') {
    return false
  }
  if (typeof obj['copy'] !== 'function' || typeof obj['slice'] !== 'function') {
    return false
  }
  if (
    typeof obj['length'] === 'number' &&
    obj['length'] > 0 &&
    typeof obj[0] !== 'number'
  ) {
    return false
  }

  const Ctor = (x as { constructor?: unknown }).constructor as
    | { isBuffer?: unknown }
    | undefined
  return !!(typeof Ctor?.isBuffer === 'function' && Ctor.isBuffer(x))
}

/**
 * Check if a value is a JSON primitive type.
 * JSON primitives are: `null`, `boolean`, `number`, or `string`.
 *
 * @param value - Value to check
 * @returns `true` if value is a JSON primitive, `false` otherwise
 *
 * @example
 * ```ts
 * isJsonPrimitive(null) // => true
 * isJsonPrimitive(true) // => true
 * isJsonPrimitive(42) // => true
 * isJsonPrimitive('hello') // => true
 * isJsonPrimitive({}) // => false
 * isJsonPrimitive([]) // => false
 * isJsonPrimitive(undefined) // => false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
}

/**
 * Parse JSON content with automatic Buffer handling and BOM stripping.
 * Provides safer JSON parsing with helpful error messages and optional error suppression.
 *
 * Features:
 * - Automatic UTF-8 Buffer conversion
 * - BOM (Byte Order Mark) stripping for cross-platform compatibility
 * - Enhanced error messages with filepath context
 * - Optional error suppression (returns `undefined` instead of throwing)
 * - Optional reviver for transforming parsed values
 *
 * @param content - JSON string or Buffer to parse
 * @param options - Optional parsing configuration
 * @returns Parsed JSON value, or `undefined` if parsing fails and `throws` is `false`
 *
 * @throws {SyntaxError} When JSON is invalid and `throws` is `true` (default)
 *
 * @example
 * ```ts
 * // Basic usage
 * const data = jsonParse('{"name":"example"}')
 * console.log(data.name) // => 'example'
 *
 * // Parse Buffer with UTF-8 BOM
 * const buffer = Buffer.from('\uFEFF{"value":42}')
 * const data = jsonParse(buffer)
 * console.log(data.value) // => 42
 *
 * // Enhanced error messages with filepath
 * try {
 *   jsonParse('invalid', { filepath: 'config.json' })
 * } catch (err) {
 *   console.error(err.message)
 *   // => "config.json: Unexpected token i in JSON at position 0"
 * }
 *
 * // Suppress errors
 * const result = jsonParse('invalid', { throws: false })
 * console.log(result) // => undefined
 *
 * // Transform values with reviver
 * const json = '{"created":"2024-01-15T10:30:00Z"}'
 * const data = jsonParse(json, {
 *   reviver: (key, value) => {
 *     if (key === 'created' && typeof value === 'string') {
 *       return new Date(value)
 *     }
 *     return value
 *   }
 * })
 * console.log(data.created instanceof Date) // => true
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function jsonParse(
  content: string | Buffer,
  options?: JsonParseOptions | undefined,
): JsonValue | undefined {
  const { filepath, reviver, throws } = {
    __proto__: null,
    ...options,
  } as JsonParseOptions
  const shouldThrow = throws === undefined || !!throws
  const jsonStr = isBuffer(content) ? content.toString('utf8') : content
  try {
    return JSONParse(stripBom(jsonStr), reviver)
  } catch (e) {
    if (shouldThrow) {
      const error = e as Error
      if (error && typeof filepath === 'string') {
        error.message = `${filepath}: ${error.message}`
      }
      throw error
    }
  }
  return undefined
}
