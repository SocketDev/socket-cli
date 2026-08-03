/**
 * @file Download utilities for SEA build assets. Re-exports the external
 *   security tools downloader (Python, Trivy, TruffleHog, OpenGrep) and shared
 *   configuration. node-smol + binject downloads live in
 *   util/asset-manager.mts, pinned via constants/base-assets.mts.
 */

export { externalTools, getRootPath, logger } from './external-tools-config.mts'
export { downloadExternalTools } from './external-tools-download.mts'
