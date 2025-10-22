/**
 * JSON output validation utilities for testing CLI commands.
 * Ensures JSON outputs match expected Socket CLI response format.
 *
 * Expected formats:
 * - Success: { ok: true, data: unknown, message?: string }
 * - Failure: { ok: false, data?: unknown, message: string, cause?: string, code?: number }
 */

export type SocketJsonSuccess<T = unknown> = {
  ok: true
  data: T
  message?: string
}

export type SocketJsonError = {
  ok: false
  data?: unknown
  message: string
  cause?: string
  code?: number
}

export type SocketJsonResponse<T = unknown> =
  | SocketJsonSuccess<T>
  | SocketJsonError

/**
 * Validates that a string contains valid JSON matching Socket CLI response format.
 * @param jsonString - The JSON string to validate
 * @param expectedExitCode - Expected exit code (0 for success, non-zero for failure)
 * @returns Parsed JSON if valid, throws if invalid
 */
export function validateSocketJson<T = unknown>(
  jsonString: string,
  expectedExitCode: number,
): SocketJsonResponse<T> {
  let parsed: any

  // Check if it's valid JSON.
  try {
    parsed = JSON.parse(jsonString)
  } catch (_e) {
    throw new Error(`Invalid JSON output: ${jsonString}`)
  }

  // Check for required ok field.
  if (typeof parsed.ok !== 'boolean') {
    throw new Error(
      `JSON output missing required 'ok' boolean field: ${jsonString}`,
    )
  }

  // Validate based on exit code expectation.
  if (expectedExitCode === 0) {
    if (parsed.ok !== true) {
      throw new Error(
        `JSON output 'ok' should be true when exit code is 0: ${jsonString}`,
      )
    }
    // Success response must have data field.
    if (parsed.data === undefined || parsed.data === null) {
      throw new Error(
        `JSON output missing required 'data' field when ok is true: ${jsonString}`,
      )
    }
  } else {
    if (parsed.ok !== false) {
      throw new Error(
        `JSON output 'ok' should be false when exit code is non-zero: ${jsonString}`,
      )
    }
    // Error response must have message field.
    if (typeof parsed.message !== 'string' || parsed.message.length === 0) {
      throw new Error(
        `JSON output missing required 'message' field when ok is false: ${jsonString}`,
      )
    }
    // If code exists, it must be a number.
    if (parsed.code !== undefined && typeof parsed.code !== 'number') {
      throw new Error(
        `JSON output 'code' field must be a number: ${jsonString}`,
      )
    }
  }

  return parsed as SocketJsonResponse<T>
}

/**
 * Helper to check if response is a success response.
 */
export function isSocketJsonSuccess<T = unknown>(
  response: SocketJsonResponse<T>,
): response is SocketJsonSuccess<T> {
  return response.ok === true
}

/**
 * Helper to check if response is an error response.
 */
export function isSocketJsonError<T = unknown>(
  response: SocketJsonResponse<T>,
): response is SocketJsonError {
  return response.ok === false
}
