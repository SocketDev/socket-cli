/**
 * @file Type declarations for jq.mjs — the dep-0 bootstrap JSON reader for
 *   composite-action shells. The .mjs is intentionally untyped (it runs before
 *   node_modules); this .d.mts mirrors the EXPORTED helpers so unit tests can
 *   import them with type-checking. Keep in step with the .mjs exports.
 */

export function resolveExtends(
  data: unknown,
  resolvedPath: string,
  visited?: Set<string> | undefined,
): unknown

export function walkKeys(value: unknown, keys: readonly string[]): unknown
