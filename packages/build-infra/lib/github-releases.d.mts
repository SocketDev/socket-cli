/**
 * Type definitions for github-releases module.
 */

/**
 * Get latest release tag for a tool with retry logic.
 */
export function getLatestRelease(
  tool: string,
  options?: { quiet?: boolean },
): Promise<string | null>

/**
 * Get download URL for a specific release asset.
 */
export function getReleaseAssetUrl(
  tag: string,
  assetName: string,
  options?: { quiet?: boolean },
): Promise<string | null>

/**
 * Download a specific release asset.
 */
export function downloadReleaseAsset(
  tag: string,
  assetName: string,
  outputPath: string,
  options?: { quiet?: boolean },
): Promise<void>
