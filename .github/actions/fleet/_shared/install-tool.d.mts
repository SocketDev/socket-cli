/**
 * @file Type declarations for install-tool.mjs — the dep-0 bootstrap helper
 *   that downloads + SRI-verifies + extracts a release asset. The .mjs is
 *   intentionally untyped (it runs before node_modules); this .d.mts mirrors
 *   the EXPORTED helpers so unit tests can import them with type-checking
 *   (same pattern as read-package-integrity.d.mts). Keep in step with the .mjs
 *   exports.
 */

export function fetchToolResponse(url: string, headers: HeadersInit): Promise<Response>

export function parseIntegrity(s: string): {
  algo: 'sha256' | 'sha384' | 'sha512'
  expected: string
}

export function toolDownloadHeaders(url: string, token: string | undefined): Record<string, string>

export function toolCacheDirectory(options: { root: string, url: string, integrity: string }): string

export function toolIntegrityMatches(bytes: Uint8Array, integrity: { algo: string, expected: string }): boolean

export function readToolArchive(options: {
  url: string
  headers: HeadersInit
  algo: string
  expected: string
  cachePath: string | undefined
}): Promise<Uint8Array>
