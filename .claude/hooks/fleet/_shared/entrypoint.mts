/**
 * @file The entrypoint guard for a "legacy" fleet hook — one that exports a
 *   pure helper (e.g. `run`) AND self-executes a `main()` when invoked
 *   directly. The idiom every such hook hand-rolled was: if (process.argv[1] &&
 *   import.meta.url === `file://${process.argv[1]}`) { main().catch(() =>
 *   process.exit(0)) } That bare check has a snapshot-build hazard. The
 *   hook-dispatch SNAPSHOT bundle imports each bundled hook's pure helper, so
 *   the hook's whole module — including this guard — lands in the bundle's
 *   top-level eval graph. When `node --build-snapshot <bundle.cjs>` is given an
 *   ABSOLUTE entry path, `process.argv[1]` is that absolute path and rolldown's
 *   CJS lowering of `import.meta.url` (`pathToFileURL(__filename).href`)
 *   resolves to the SAME absolute file URL — so the equality holds, `main()`
 *   fires DURING THE BUILD PASS, hits empty stdin, and `process.exit(0)`s,
 *   which silently aborts serialization (exit 0, NO blob, only the
 *   `node:module` warning). A RELATIVE entry path masks it (bare `argv[1]` ≠
 *   absolute URL), so the bug is path-form-dependent and easy to miss.
 *   `isHookEntrypoint` is the shared, snapshot-safe replacement: it is the same
 *   "am I the process entrypoint?" test, plus a `!isBuildingSnapshot()` short
 *   circuit so the guard is inert inside the snapshot builder. `defineHook`
 *   hooks get the equivalent gating from `isGuardRunContext` in guard.mts; this
 *   helper is for the legacy pure-`run` hooks that don't go through
 *   `runGuard`.
 */

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import v8 from 'node:v8'

/**
 * True when the current module IS the process entrypoint AND we're not inside a
 * V8 snapshot build pass. Callers pass their own `import.meta.url`; the
 * self-exec runs only when this returns true.
 *
 * @param moduleUrl - The calling module's `import.meta.url`.
 */
export function isHookEntrypoint(moduleUrl: string | undefined): boolean {
  // A snapshot BUILD pass is never an entrypoint context — see the file header
  // for why an absolute `--build-snapshot` path makes the bare check fire and
  // abort serialization.
  if (v8.startupSnapshot.isBuildingSnapshot()) {
    return false
  }
  const entry = process.argv[1]
  if (!moduleUrl || !entry) {
    return false
  }
  return moduleUrl === pathToFileURL(entry).href
}
