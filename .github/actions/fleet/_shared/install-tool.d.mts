/**
 * @file Type declarations for install-tool.mjs — the dep-0 bootstrap helper
 *   that downloads + SRI-verifies + extracts a release asset. The .mjs is
 *   intentionally untyped (it runs before node_modules); this .d.mts mirrors
 *   the EXPORTED helpers so unit tests can import them with type-checking
 *   (same pattern as read-package-integrity.d.mts). Keep in step with the .mjs
 *   exports.
 */

export function parseIntegrity(s: string): {
  algo: 'sha256' | 'sha384' | 'sha512'
  expected: string
}
