/**
 * @fileoverview SSRI (Subresource Integrity) hash format utilities.
 * Provides conversion and validation for SSRI and hex hash formats.
 */

/**
 * Convert SSRI format hash to hex format.
 *
 * Takes a hash in SSRI format (e.g., "sha256-base64hash") and converts it to
 * standard hex format (e.g., "hexstring").
 *
 * @param ssri - Hash in SSRI format (algorithm-base64)
 * @returns Hex string representation of the hash
 * @throws Error if SSRI format is invalid
 *
 * @example
 * ```typescript
 * const hex = ssriToHex('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=')
 * // Returns: '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856'
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function ssriToHex(ssri: string): string {
  const match = /^([a-z0-9]+)-([A-Za-z0-9+/]+=*)$/i.exec(ssri)
  if (!match || !match[2] || match[2].length < 2) {
    throw new Error(`Invalid SSRI format: ${ssri}`)
  }
  const base64Hash = match[2]
  // Convert base64 to hex.
  const buffer = Buffer.from(base64Hash, 'base64')
  return buffer.toString('hex')
}

/**
 * Convert hex format hash to SSRI format.
 *
 * Takes a hash in hex format and converts it to SSRI format with the specified
 * algorithm prefix (defaults to sha256).
 *
 * @param hex - Hash in hex format
 * @param algorithm - Hash algorithm (default: 'sha256')
 * @returns SSRI format hash (algorithm-base64)
 * @throws Error if hex format is invalid
 *
 * @example
 * ```typescript
 * const ssri = hexToSsri('76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856')
 * // Returns: 'sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY='
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function hexToSsri(hex: string, algorithm = 'sha256'): string {
  if (!/^[a-f0-9]+$/i.test(hex)) {
    throw new Error(`Invalid hex format: ${hex}`)
  }
  // Convert hex to base64.
  const buffer = Buffer.from(hex, 'hex')
  const base64Hash = buffer.toString('base64')
  return `${algorithm}-${base64Hash}`
}

/**
 * Check if a string is valid SSRI format.
 *
 * Validates that a string matches the SSRI format pattern (algorithm-base64).
 * Does not verify that the base64 encoding is valid.
 *
 * @param value - String to validate
 * @returns True if string matches SSRI format
 *
 * @example
 * ```typescript
 * isValidSsri('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=') // true
 * isValidSsri('76682a9f...') // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isValidSsri(value: string): boolean {
  return /^[a-z0-9]+-[A-Za-z0-9+/]{2,}=*$/i.test(value)
}

/**
 * Check if a string is valid hex format.
 *
 * Validates that a string contains only hexadecimal characters (0-9, a-f).
 * Does not verify hash length or algorithm.
 *
 * @param value - String to validate
 * @returns True if string is valid hex format
 *
 * @example
 * ```typescript
 * isValidHex('76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856') // true
 * isValidHex('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=') // false
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function isValidHex(value: string): boolean {
  return /^[a-f0-9]+$/i.test(value)
}

/**
 * Parse SSRI format into components.
 *
 * Extracts the algorithm and base64 hash from an SSRI string.
 *
 * @param ssri - Hash in SSRI format
 * @returns Object with algorithm and base64Hash properties
 * @throws Error if SSRI format is invalid
 *
 * @example
 * ```typescript
 * const { algorithm, base64Hash } = parseSsri('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=')
 * // Returns: { algorithm: 'sha256', base64Hash: 'dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=' }
 * ```
 */
/*@__NO_SIDE_EFFECTS__*/
export function parseSsri(ssri: string): {
  algorithm: string
  base64Hash: string
} {
  const match = /^([a-z0-9]+)-([A-Za-z0-9+/]+=*)$/i.exec(ssri)
  if (!match || !match[1] || !match[2] || match[2].length < 2) {
    throw new Error(`Invalid SSRI format: ${ssri}`)
  }
  const algorithm = match[1]
  const base64Hash = match[2]
  return { algorithm, base64Hash }
}
