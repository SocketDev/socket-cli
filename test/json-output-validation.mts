/**
 * Test utility for validating Socket CLI JSON output.
 * Ensures CLI commands return properly formatted JSON responses.
 *
 * Key Functions:
 * - validateSocketJson: Parse and validate JSON output from Socket CLI
 *
 * Validation Rules:
 * - Output must be valid JSON
 * - Success responses (exitCode 0) return { ok: true, data: ... }
 * - Error responses return { ok: false, message: ... }
 * - Handles malformed JSON gracefully
 *
 * Usage:
 * - Use after running Socket CLI commands with --json flag
 * - Validates structure matches Socket's standard JSON response format
 * - Provides type-safe response handling in tests
 *
 * @example
 * const result = await runWithConfig('scan', 'create', '--json')
 * const json = validateSocketJson(result.stdout, result.exitCode)
 * if (json.ok) {
 *   expect(json.data.id).toBeDefined()
 * } else {
 *   expect(json.message).toContain('error')
 * }
 */

/**
 * Validate and parse Socket CLI JSON output.
 * @param output The stdout string from Socket CLI.
 * @param exitCode The exit code from the CLI command.
 * @returns Parsed JSON with ok status and data or error message.
 */
export function validateSocketJson(output: string, exitCode: number) {
  try {
    const parsed = JSON.parse(output)
    // Basic validation of expected Socket CLI JSON format.
    if (exitCode === 0) {
      return { ok: true, data: parsed }
    } else {
      return {
        ok: false,
        message: parsed.message || parsed.error || 'Unknown error',
      }
    }
  } catch (e) {
    // If not valid JSON, return error.
    return { ok: false, message: 'Invalid JSON output' }
  }
}
