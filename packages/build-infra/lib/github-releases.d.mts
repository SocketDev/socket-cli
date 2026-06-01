/**
 * Type definitions for github-releases module.
 */

/**
 * Get latest release tag for a repository with retry logic.
 */
export function getLatestRelease(
  owner: string,
  repo: string,
  options?: {
    prefix?: string | undefined
    quiet?: boolean | undefined
  },
): Promise<string | null>

/**
 * Get download URL for a specific release asset.
 */
export function getReleaseAssetUrl(
  owner: string,
  repo: string,
  tag: string,
  assetName: string,
  options?: { quiet?: boolean | undefined },
): Promise<string | null>

/**
 * Download a specific release asset.
 */
export function downloadReleaseAsset(
  owner: string,
  repo: string,
  tag: string,
  assetName: string,
  outputPath: string,
  options?: { quiet?: boolean | undefined },
): Promise<void>
