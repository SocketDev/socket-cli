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

  // Truncate to keep error messages readable; full payload goes in the message.
  const preview = jsonString.length > 200
    ? `${jsonString.slice(0, 200)}...`
    : jsonString

  // Check if it's valid JSON.
  try {
    parsed = JSON.parse(jsonString)
  } catch (e) {
    throw new Error(
      `command output is not valid JSON (JSON.parse threw: ${e instanceof Error ? e.message : String(e)}); got: ${preview} — check for unclosed braces, trailing commas, or non-JSON text mixed into stdout`,
    )
  }

  // Check for required ok field.
  if (typeof parsed.ok !== 'boolean') {
    throw new Error(
      `Socket JSON contract violation: missing boolean "ok" field (contract: {ok: boolean, data?: any, message?: string}); got: ${preview} — add ok:true for success, ok:false for failure in the output handler`,
    )
  }

  // Validate based on exit code expectation.
  if (expectedExitCode === 0) {
    if (parsed.ok !== true) {
      throw new Error(
        `Socket JSON contract violation: exit code is 0 but "ok" is ${JSON.stringify(parsed.ok)} (expected true); got: ${preview} — set ok:true when the command succeeds, or return a non-zero exit code`,
      )
    }
    // Success response must have data field.
    if (parsed.data === undefined || parsed.data === null) {
      throw new Error(
        `Socket JSON contract violation: ok:true must include a non-null "data" field (got: ${JSON.stringify(parsed.data)}); full output: ${preview} — return an empty object or array instead of undefined/null`,
      )
    }
  } else {
    if (parsed.ok !== false) {
      throw new Error(
        `Socket JSON contract violation: exit code is ${expectedExitCode} but "ok" is ${JSON.stringify(parsed.ok)} (expected false); got: ${preview} — set ok:false on failure, or exit 0 on success`,
      )
    }
    // Error response must have message field.
    if (typeof parsed.message !== 'string' || !parsed.message.length) {
      throw new Error(
        `Socket JSON contract violation: ok:false must include a non-empty "message" string (got: ${JSON.stringify(parsed.message)}); full output: ${preview} — provide a user-facing error description`,
      )
    }
    // If code exists, it must be a number.
    if (parsed.code !== undefined && typeof parsed.code !== 'number') {
      throw new Error(
        `Socket JSON contract violation: "code" field must be a number when present (got: ${typeof parsed.code} ${JSON.stringify(parsed.code)}); full output: ${preview} — drop the field or set it to an integer`,
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
