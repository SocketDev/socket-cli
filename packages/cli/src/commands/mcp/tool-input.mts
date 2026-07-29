/**
 * Validators for MCP tool arguments.
 *
 * Tool arguments are untrusted. They arrive from whatever the model decided to
 * emit, which in turn can be steered by any content the model has read — a
 * package README, a dependency's source, an issue body. A schema check proves
 * the shape; these predicates prove the value is one the CLI is willing to put
 * into an outbound URL or echo back into a response.
 *
 * The tools also re-derive rather than accept: `package_files` builds its PURL
 * from `ecosystem`/`depname`/`version` instead of taking a caller-supplied PURL
 * string, so no caller chooses the path segment the API sees.
 */

// Longest caller-supplied string echoed back into a response header line.
// Bounds the output a single tool call can produce from one argument.
export const MAX_TOOL_LABEL_LENGTH = 256

// Longest caller-supplied string accepted into a PURL component.
export const MAX_PURL_FIELD_LENGTH = 512

// Socket organization slugs are lowercase alphanumerics with separators. Anchor
// the whole string so a slug can never carry `/`, `?`, `#`, or whitespace into
// the API path even before percent-encoding runs.
const ORG_SLUG_REGEXP = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/iu

// Content-addressed blob hashes are URL-safe base64 tokens. The Socket blob
// host prefixes them `Q` (single blob) or `S` (chunked manifest).
const BLOB_HASH_REGEXP = /^[QS][A-Za-z0-9_-]{15,511}$/u

export function isBoundedToolString(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength
}

export function isSocketBlobHash(value: string): boolean {
  return BLOB_HASH_REGEXP.test(value)
}

export function isSocketOrgSlug(value: string): boolean {
  return ORG_SLUG_REGEXP.test(value)
}

/**
 * Clip a caller-supplied display string to a bounded length so a tool response
 * header cannot be padded out by a hostile argument.
 */
export function truncateToolLabel(
  value: string,
  maxLength = MAX_TOOL_LABEL_LENGTH,
): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}
