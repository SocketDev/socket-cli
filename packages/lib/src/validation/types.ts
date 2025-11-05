/**
 * @fileoverview Validation type definitions.
 * Provides core types for schema validation and JSON parsing with security features.
 */

/**
 * Result of a schema validation operation.
 * Contains either successful parsed data or error information.
 *
 * @template T - The expected type of the parsed data
 *
 * @example
 * ```ts
 * const result: ParseResult<User> = schema.safeParse(data)
 * if (result.success) {
 *   console.log(result.data) // User object
 * } else {
 *   console.error(result.error) // Error details
 * }
 * ```
 */
export interface ParseResult<T> {
  /** Indicates whether parsing was successful */
  success: boolean
  /** Parsed and validated data (only present when `success` is `true`) */
  data?: T | undefined
  /** Error information (only present when `success` is `false`) */
  error?: any
}

/**
 * Base schema interface compatible with Zod and similar validation libraries.
 * Provides both safe and throwing parsing methods.
 *
 * @template T - The expected output type after validation
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * const userSchema = z.object({
 *   name: z.string(),
 *   age: z.number()
 * })
 *
 * // Schema satisfies this interface
 * const schema: Schema<User> = userSchema
 * const result = schema.safeParse({ name: 'Alice', age: 30 })
 * ```
 */
export interface Schema<T = any> {
  /**
   * Safely parse data without throwing errors.
   * Returns a result object indicating success or failure.
   *
   * @param data - The data to validate
   * @returns Parse result with success flag and data or error
   */
  safeParse(data: any): ParseResult<T>

  /**
   * Parse data and throw an error if validation fails.
   * Use this when you want to fail fast on invalid data.
   *
   * @param data - The data to validate
   * @returns The validated and parsed data
   * @throws {Error} When validation fails
   */
  parse(data: any): T

  /**
   * Optional schema name for debugging and error messages.
   * Useful for identifying which schema failed in complex validation chains.
   */
  _name?: string | undefined
}

/**
 * Options for configuring JSON parsing behavior with security controls.
 *
 * @example
 * ```ts
 * const options: JsonParseOptions = {
 *   maxSize: 1024 * 1024, // 1MB limit
 *   allowPrototype: false // Block prototype pollution
 * }
 * ```
 */
export interface JsonParseOptions {
  /**
   * Allow dangerous prototype pollution keys (`__proto__`, `constructor`, `prototype`).
   * Set to `true` only if you trust the JSON source completely.
   *
   * @default false
   *
   * @example
   * ```ts
   * // Will throw error by default
   * safeJsonParse('{"__proto__": {"polluted": true}}')
   *
   * // Allows the parse (dangerous!)
   * safeJsonParse('{"__proto__": {"polluted": true}}', undefined, {
   *   allowPrototype: true
   * })
   * ```
   */
  allowPrototype?: boolean | undefined

  /**
   * Maximum allowed size of JSON string in bytes.
   * Prevents memory exhaustion from extremely large payloads.
   *
   * @default 10_485_760 (10 MB)
   *
   * @example
   * ```ts
   * // Limit to 1KB
   * safeJsonParse(jsonString, undefined, { maxSize: 1024 })
   * ```
   */
  maxSize?: number | undefined
}

/**
 * Discriminated union type for JSON parsing results.
 * Enables type-safe handling of success and failure cases.
 *
 * @template T - The expected type of the parsed data
 *
 * @example
 * ```ts
 * const result: JsonParseResult<User> = parseJsonWithResult(jsonString)
 *
 * if (result.success) {
 *   // TypeScript knows result.data is available
 *   console.log(result.data.name)
 * } else {
 *   // TypeScript knows result.error is available
 *   console.error(result.error)
 * }
 * ```
 */
export type JsonParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }
