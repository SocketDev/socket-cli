/**
 * Update cache storage utilities for Socket CLI.
 * @deprecated This module is deprecated. Use @socketsecurity/lib/dlx-manifest instead.
 *
 * Re-exports from @socketsecurity/lib/dlx-manifest for backward compatibility.
 * This file will be removed in a future version.
 */

import { DlxManifest } from '@socketsecurity/lib/dlx-manifest'

export {
  type BinaryDetails,
  dlxManifest as updateStore,
  isBinaryEntry,
  isPackageEntry,
  type ManifestEntry,
  type PackageDetails,
  type StoreRecord,
} from '@socketsecurity/lib/dlx-manifest'

/**
 * Options for UpdateStore (backward compatibility wrapper).
 */
export interface UpdateStoreOptions {
  /**
   * Custom store file path (defaults to ~/.socket/_dlx/.dlx-manifest.json).
   */
  storePath?: string
}

/**
 * UpdateStore class (backward compatibility wrapper).
 * Maps legacy storePath option to manifestPath for DlxManifest.
 */
export class UpdateStore extends DlxManifest {
  constructor(options: UpdateStoreOptions = {}) {
    // Map storePath to manifestPath for backward compatibility.
    super({
      manifestPath: options.storePath,
    })
  }
}
