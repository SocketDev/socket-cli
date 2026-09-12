/**
 * Typed reads out of a tool's raw argument record.
 *
 * The compiled schema check in `server.mts` already proved the shape before a
 * handler runs. Reading field by field keeps that proof honest at runtime
 * rather than casting the record to a declared interface, which would let a
 * schema/interface drift ship silently — the interface would claim a field the
 * schema never validated.
 */

export function readToolBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key]
  return typeof value === 'boolean' ? value : undefined
}

export function readToolNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readToolString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value ? value : undefined
}
