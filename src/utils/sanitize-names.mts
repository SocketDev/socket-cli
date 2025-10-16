import { SOCKET_DEFAULT_REPOSITORY } from '../constants/socket.mts'

/**
 * Sanitizes a name to comply with repository naming constraints.
 * Constraints: 100 or less A-Za-z0-9 characters only with non-repeating,
 * non-leading or trailing ., _ or - only.
 *
 * @param name - The name to sanitize
 * @returns Sanitized name that complies with repository naming rules, or empty string if no valid characters
 */
function sanitizeName(name: string): string {
  if (!name) {
    return ''
  }

  // Replace sequences of illegal characters with underscores.
  const sanitized = name
    // Replace any sequence of non-alphanumeric characters (except ., _, -) with underscore.
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    // Replace sequences of multiple allowed special chars with single underscore.
    .replace(/[._-]{2,}/g, '_')
    // Remove leading special characters.
    .replace(/^[._-]+/, '')
    // Remove trailing special characters.
    .replace(/[._-]+$/, '')
    // Truncate to 100 characters max.
    .slice(0, 100)

  return sanitized
}

/**
 * Extracts and sanitizes a repository name.
 *
 * @param name - The repository name to extract and sanitize
 * @returns Sanitized repository name, or default repository name if empty
 */
export function extractName(name: string): string {
  const sanitized = sanitizeName(name)
  return sanitized || SOCKET_DEFAULT_REPOSITORY
}

/**
 * Extracts and sanitizes a repository owner name.
 *
 * @param owner - The repository owner name to extract and sanitize
 * @returns Sanitized repository owner name, or undefined if input is empty
 */
export function extractOwner(owner: string): string | undefined {
  if (!owner) {
    return undefined
  }
  const sanitized = sanitizeName(owner)
  return sanitized || undefined
}
