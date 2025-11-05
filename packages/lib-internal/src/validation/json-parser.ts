/**
 * @fileoverview Safe JSON parsing with validation and security controls.
 * Provides protection against prototype pollution, size limits, and schema validation.
 *
 * Key Features:
 * - Prototype pollution protection: Blocks `__proto__`, `constructor`, and `prototype` keys
 * - Size limits: Configurable maximum JSON string size (default 10MB)
 * - Schema validation: Optional Zod-compatible schema validation
 * - NDJSON support: Parse newline-delimited JSON streams
 * - Memory safety: Prevents memory exhaustion attacks
 */

import type { JsonParseOptions, JsonParseResult, Schema } from './types'

const { hasOwn: ObjectHasOwn } = Object

/**
 * Safely parse JSON with optional schema validation and security controls.
 * Throws errors on parse failures, validation failures, or security violations.
 *
 * This is the recommended method for parsing untrusted JSON input as it provides
 * multiple layers of security including prototype pollution protection and size limits.
 *
 * @template T - The expected type of the parsed data
 * @param jsonString - The JSON string to parse
 * @param schema - Optional Zod-compatible schema for validation
 * @param options - Parsing options for security and behavior control
 * @returns The parsed and validated data
 *
 * @throws {Error} When JSON string exceeds `maxSize`
 * @throws {Error} When JSON parsing fails
 * @throws {Error} When prototype pollution keys are detected (unless `allowPrototype` is `true`)
 * @throws {Error} When schema validation fails
 *
 * @example
 * ```ts
 * // Basic parsing with type inference
 * const data = safeJsonParse<User>('{"name":"Alice","age":30}')
 *
 * // With schema validation
 * import { z } from 'zod'
 * const userSchema = z.object({
 *   name: z.string(),
 *   age: z.number()
 * })
 * const user = safeJsonParse('{"name":"Alice","age":30}', userSchema)
 *
 * // With size limit
 * const data = safeJsonParse(jsonString, undefined, {
 *   maxSize: 1024 * 1024 // 1MB
 * })
 *
 * // Allow prototype keys (dangerous - only for trusted sources)
 * const data = safeJsonParse(jsonString, undefined, {
 *   allowPrototype: true
 * })
 * ```
 */
export function safeJsonParse<T = unknown>(
  jsonString: string,
  schema?: Schema<T> | undefined,
  options: JsonParseOptions = {},
): T {
  const { allowPrototype = false, maxSize = 10 * 1024 * 1024 } = options

  // Check size limit
  const byteLength = Buffer.byteLength(jsonString, 'utf8')
  if (byteLength > maxSize) {
    throw new Error(
      `JSON string exceeds maximum size limit${maxSize !== 10 * 1024 * 1024 ? ` of ${maxSize} bytes` : ''}`,
    )
  }

  // Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error}`)
  }

  // Check for prototype pollution
  if (
    !allowPrototype &&
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    const dangerous = ['__proto__', 'constructor', 'prototype']
    for (const key of dangerous) {
      if (ObjectHasOwn(parsed, key)) {
        throw new Error(
          'JSON contains potentially malicious prototype pollution keys',
        )
      }
    }
  }

  // Validate against schema if provided
  if (schema) {
    const result = schema.safeParse(parsed)
    if (!result.success) {
      const errors = result.error.issues
        .map(
          (issue: { path: Array<string | number>; message: string }) =>
            `${issue.path.join('.')}: ${issue.message}`,
        )
        .join(', ')
      throw new Error(`Validation failed: ${errors}`)
    }
    return result.data as T
  }

  return parsed as T
}

/**
 * Attempt to parse JSON, returning `undefined` on any error.
 * This is a non-throwing wrapper around `safeJsonParse` for cases where
 * you want to gracefully handle parse failures without try-catch blocks.
 *
 * Use this when parsing is optional or you have a fallback strategy.
 * For critical parsing where you need error details, use `safeJsonParse` or `parseJsonWithResult`.
 *
 * @template T - The expected type of the parsed data
 * @param jsonString - The JSON string to parse
 * @param schema - Optional Zod-compatible schema for validation
 * @param options - Parsing options for security and behavior control
 * @returns The parsed data on success, or `undefined` on any error
 *
 * @example
 * ```ts
 * // Graceful fallback to default
 * const config = tryJsonParse<Config>(jsonString) ?? defaultConfig
 *
 * // Optional parsing
 * const data = tryJsonParse(possiblyInvalidJson)
 * if (data) {
 *   console.log('Parsed successfully:', data)
 * }
 *
 * // With schema validation
 * const user = tryJsonParse(jsonString, userSchema)
 * ```
 */
export function tryJsonParse<T = unknown>(
  jsonString: string,
  schema?: Schema<T> | undefined,
  options?: JsonParseOptions | undefined,
): T | undefined {
  try {
    return safeJsonParse(jsonString, schema, options)
  } catch {
    return undefined
  }
}

/**
 * Parse JSON and return a discriminated union result.
 * Never throws - always returns a result object with success/failure information.
 *
 * This is ideal when you need detailed error messages and type-safe result handling.
 * The discriminated union allows TypeScript to narrow types based on the `success` flag.
 *
 * @template T - The expected type of the parsed data
 * @param jsonString - The JSON string to parse
 * @param schema - Optional Zod-compatible schema for validation
 * @param options - Parsing options for security and behavior control
 * @returns Result object with either `{success: true, data}` or `{success: false, error}`
 *
 * @example
 * ```ts
 * // Type-safe error handling
 * const result = parseJsonWithResult<User>(jsonString, userSchema)
 *
 * if (result.success) {
 *   // TypeScript knows result.data is available
 *   console.log(`User: ${result.data.name}`)
 * } else {
 *   // TypeScript knows result.error is available
 *   console.error(`Parse failed: ${result.error}`)
 * }
 *
 * // Early return pattern
 * const result = parseJsonWithResult(jsonString)
 * if (!result.success) {
 *   logger.error(result.error)
 *   return
 * }
 * processData(result.data)
 * ```
 */
export function parseJsonWithResult<T = unknown>(
  jsonString: string,
  schema?: Schema<T> | undefined,
  options?: JsonParseOptions | undefined,
): JsonParseResult<T> {
  try {
    const data = safeJsonParse(jsonString, schema, options)
    return { success: true, data }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Create a reusable JSON parser with pre-configured schema and options.
 * Useful for parsing multiple JSON strings with the same validation rules.
 *
 * The returned parser function can accept per-call options that override the defaults.
 * This factory pattern reduces repetition when parsing many similar JSON payloads.
 *
 * @template T - The expected type of the parsed data
 * @param schema - Optional Zod-compatible schema for validation
 * @param defaultOptions - Default parsing options applied to all parse calls
 * @returns A parser function that accepts a JSON string and optional per-call options
 *
 * @example
 * ```ts
 * // Create a parser for API responses
 * import { z } from 'zod'
 * const apiResponseSchema = z.object({
 *   status: z.string(),
 *   data: z.unknown()
 * })
 *
 * const parseApiResponse = createJsonParser(apiResponseSchema, {
 *   maxSize: 5 * 1024 * 1024 // 5MB limit for API responses
 * })
 *
 * // Use the parser multiple times
 * const response1 = parseApiResponse(json1)
 * const response2 = parseApiResponse(json2)
 *
 * // Override options for specific calls
 * const response3 = parseApiResponse(json3, { maxSize: 10 * 1024 * 1024 })
 * ```
 */
export function createJsonParser<T = unknown>(
  schema?: Schema<T> | undefined,
  defaultOptions?: JsonParseOptions | undefined,
) {
  return (jsonString: string, options?: JsonParseOptions | undefined): T => {
    return safeJsonParse(jsonString, schema, { ...defaultOptions, ...options })
  }
}

/**
 * Parse newline-delimited JSON (NDJSON) into an array.
 * Each line is treated as a separate JSON object. Empty lines are skipped.
 *
 * NDJSON format is commonly used for streaming logs, bulk data transfers,
 * and event streams where each line represents a complete JSON document.
 *
 * @template T - The expected type of each parsed JSON object
 * @param ndjson - Newline-delimited JSON string (supports both `\n` and `\r\n`)
 * @param schema - Optional Zod-compatible schema for validation of each line
 * @param options - Parsing options applied to each line
 * @returns Array of parsed objects, one per non-empty line
 *
 * @throws {Error} When any line fails to parse (includes line number in error message)
 *
 * @example
 * ```ts
 * // Parse NDJSON logs
 * const ndjsonString = `
 * {"level":"info","message":"Server started"}
 * {"level":"error","message":"Connection failed"}
 * {"level":"info","message":"Retrying..."}
 * `
 * const logs = parseNdjson<LogEntry>(ndjsonString, logSchema)
 * console.log(logs.length) // 3
 *
 * // Parse with size limits per line
 * const entries = parseNdjson(ndjson, undefined, { maxSize: 1024 })
 *
 * // Empty lines are automatically skipped
 * const data = parseNdjson('{"a":1}\n\n{"b":2}\n') // 2 objects
 * ```
 */
export function parseNdjson<T = unknown>(
  ndjson: string,
  schema?: Schema<T> | undefined,
  options?: JsonParseOptions | undefined,
): T[] {
  const results: T[] = []
  const lines = ndjson.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line || line === '') {
      continue
    }

    try {
      const parsed = safeJsonParse<T>(line, schema, options)
      results.push(parsed)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse NDJSON at line ${i + 1}: ${message}`)
    }
  }

  return results
}

/**
 * Stream-parse newline-delimited JSON (NDJSON) using a generator.
 * Yields one parsed object at a time, enabling memory-efficient processing of large NDJSON files.
 *
 * Unlike `parseNdjson` which loads all results into memory, this generator allows
 * processing each line individually, making it ideal for large datasets or streaming scenarios.
 *
 * @template T - The expected type of each parsed JSON object
 * @param ndjson - Newline-delimited JSON string (supports both `\n` and `\r\n`)
 * @param schema - Optional Zod-compatible schema for validation of each line
 * @param options - Parsing options applied to each line
 * @yields Parsed objects one at a time as the generator iterates
 *
 * @throws {Error} When any line fails to parse (includes line number in error message)
 *
 * @example
 * ```ts
 * // Memory-efficient processing of large NDJSON files
 * const ndjsonString = readLargeFile('logs.ndjson')
 *
 * for (const log of streamNdjson<LogEntry>(ndjsonString, logSchema)) {
 *   if (log.level === 'error') {
 *     console.error('Error found:', log.message)
 *   }
 * }
 *
 * // Collect filtered results without loading everything
 * const errors = [...streamNdjson(ndjson)]
 *   .filter(log => log.level === 'error')
 *
 * // Early termination when condition is met
 * for (const entry of streamNdjson(ndjson)) {
 *   if (entry.id === targetId) {
 *     processEntry(entry)
 *     break // Stop processing remaining lines
 *   }
 * }
 * ```
 */
export function* streamNdjson<T = unknown>(
  ndjson: string,
  schema?: Schema<T> | undefined,
  options?: JsonParseOptions | undefined,
): Generator<T, void, unknown> {
  const lines = ndjson.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line || line === '') {
      continue
    }

    try {
      yield safeJsonParse<T>(line, schema, options)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse NDJSON at line ${i + 1}: ${message}`)
    }
  }
}
