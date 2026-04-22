/**
 * Shared utilities for checksum modules.
 *
 * NOTE: Each tool-specific module MUST use direct process.env['INLINED_*_CHECKSUMS']
 * access because esbuild's define plugin can only replace direct references.
 * This module provides shared parsing and validation logic.
 */

export type Checksums = Record<string, string>

/**
 * Parse checksums from a JSON string.
 * Returns empty object if parsing fails or input is empty.
 *
 * @param jsonString - JSON string of checksums (or undefined/empty).
 * @param toolName - Tool name for error messages.
 * @returns Parsed checksums or empty object.
 * @throws Error if JSON is malformed (not empty).
 */
export function parseChecksums(
  jsonString: string | undefined,
  toolName: string,
): Checksums {
  if (!jsonString) {
    // In development mode (not inlined), return empty object.
    // Build validation will catch missing checksums at build time.
    return {}
  }
  try {
    return JSON.parse(jsonString) as Checksums
  } catch (e) {
    throw new Error(
      `INLINED_${toolName.toUpperCase()}_CHECKSUMS is not valid JSON at runtime (JSON.parse threw: ${(e as Error).message}); the build-time inline step produced corrupt data — rebuild socket-cli (\`pnpm run build:cli\`) and check bundle-tools.json tools.${toolName}.checksums`,
    )
  }
}

/**
 * Require a checksum for an asset.
 * In production builds (checksums inlined), throws a hard error if asset is missing.
 * In dev mode (checksums not inlined), returns undefined to allow development.
 *
 * @param checksums - Parsed checksums object.
 * @param assetName - The asset filename to look up.
 * @param toolName - Tool name for error messages.
 * @returns The SHA-256 hex checksum, or undefined in dev mode.
 * @throws Error if checksum is not found in production builds.
 */
export function requireChecksum(
  checksums: Checksums,
  assetName: string,
  toolName: string,
): string | undefined {
  // In dev mode, checksums are not inlined so the object is empty.
  // Allow downloads without verification during development.
  if (Object.keys(checksums).length === 0) {
    return undefined
  }

  // In production mode, checksums are inlined.
  // Require checksum for every asset - missing checksum is a HARD ERROR.
  const sha256 = checksums[assetName]
  if (!sha256) {
    throw new Error(
      `bundle-tools.json tools.${toolName}.checksums has no entry for asset "${assetName}" (available: ${Object.keys(checksums).join(', ') || '<empty>'}); add the SHA-256 for this asset via \`pnpm run sync-checksums\` — do NOT ship without verification`,
    )
  }
  return sha256
}
