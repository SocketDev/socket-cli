/**
 * @file Download utilities for SEA build assets. Manages downloads of node-smol
 *   binaries, binject tool, and security tools from GitHub releases. Sections:
 *
 *   1. Constants and Utilities - Shared configuration, auth, platform mappings.
 *   2. Node and Binject Downloads - Binary downloads for SEA injection.
 *   3. External Security Tools - Python, Trivy, TruffleHog, OpenGrep downloads.
 */

export { externalTools, getRootPath, logger } from './external-tools-config.mts'
export { downloadExternalTools } from './external-tools-download.mts'
export { getAuthHeaders, getLatestBinjectVersion } from './binject-releases.mts'
