/** @fileoverview Security-related scrubbers for test snapshots. */

/**
 * Strip API token error messages to avoid snapshot inconsistencies
 * when local environment has/doesn't have tokens set.
 */
export function stripTokenErrorMessages(str: string): string {
  return str.replace(
    /^\s*[×✖]\s+This command requires a Socket API token for access.*$/gm,
    '',
  )
}

/**
 * Sanitize Socket API tokens to prevent leaking credentials into snapshots.
 * Socket tokens follow the format: sktsec_[alphanumeric+underscore characters]
 */
export function sanitizeTokens(str: string): string {
  // Match Socket API tokens: sktsec_ followed by word characters
  const tokenPattern = /sktsec_\w+/g
  let result = str.replace(tokenPattern, 'sktsec_REDACTED_TOKEN')

  // Sanitize token values in JSON-like structures
  result = result.replace(
    /"apiToken"\s*:\s*"sktsec_[^"]+"/g,
    '"apiToken":"sktsec_REDACTED_TOKEN"',
  )

  // Sanitize token prefixes that might be displayed (e.g., "zP416" -> "REDAC")
  // Match 5-character alphanumeric strings that appear after "token:" labels
  result = result.replace(
    /token:\s*\[?\d+m\]?([A-Za-z0-9]{5})\*{3}/gi,
    'token: REDAC***',
  )

  return result
}
