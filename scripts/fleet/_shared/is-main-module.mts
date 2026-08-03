/**
 * @file Entrypoint detection for fleet scripts. The naive
 *   `import.meta.url === file://argv[1]` comparison is symlink-fragile:
 *   Node resolves the REAL path for a module's `import.meta.url` while
 *   `process.argv[1]` keeps the path as invoked, so a script spawned via a
 *   symlinked location (macOS `/var` → `/private/var`, the shape every
 *   mkdtemp-based integration test hits) never matches and `main()` silently
 *   does not run. Compare realpaths on both sides instead.
 */

import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * True when the module at `importMetaUrl` is the process entrypoint.
 * `entryPath` defaults to `process.argv[1]`; injectable for tests.
 */
export function isMainModule(
  importMetaUrl: string,
  entryPath?: string | undefined,
): boolean {
  const entry = entryPath ?? process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entry)
  } catch {
    return false
  }
}
