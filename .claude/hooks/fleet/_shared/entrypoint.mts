/**
 * @file The entrypoint guard for a "legacy" fleet hook — one that exports a
 *   pure helper (e.g. `run`) AND self-executes a `main()` when invoked
 *   directly. A bare `import.meta.url === file-URL-of-argv[1]` equality has two
 *   hazards this helper closes. (1) Snapshot builds: the hook-dispatch SNAPSHOT
 *   bundle imports each bundled hook's pure helper, so the hook's whole module
 *   — including its guard — lands in the bundle's top-level eval graph. When
 *   `node --build-snapshot <bundle.cjs>` is given an ABSOLUTE entry path,
 *   `process.argv[1]` is that absolute path and rolldown's CJS lowering of
 *   `import.meta.url` (`pathToFileURL(__filename).href`) resolves to the SAME
 *   absolute file URL — the equality holds, `main()` fires DURING THE BUILD
 *   PASS, hits empty stdin, and `process.exit(0)`s, silently aborting
 *   serialization (exit 0, NO blob, only the `node:module` warning). A
 *   RELATIVE entry path masks it, so the bug is path-form-dependent and easy
 *   to miss. (2) Symlinks: Node resolves the REAL path for `import.meta.url`
 *   while `argv[1]` keeps the path as invoked, so a symlinked invocation never
 *   matches and the self-exec silently does not run. `isHookEntrypoint` is the
 *   shared guard closing both: a realpath comparison plus a
 *   `!isBuildingSnapshot()` short circuit. `defineHook` hooks get the
 *   equivalent gating from `isGuardRunContext` in guard.mts; this helper is
 *   for the legacy pure-`run` hooks that don't go through `runGuard`.
 */

import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import v8 from 'node:v8'

/**
 * True when the current module IS the process entrypoint AND we're not inside a
 * V8 snapshot build pass. Callers pass their own `import.meta.url`; the
 * self-exec runs only when this returns true. Compares realpaths on both sides:
 * Node resolves the REAL path for `import.meta.url` while `process.argv[1]`
 * keeps the path as invoked, so a bare URL comparison never matches under a
 * symlinked invocation (macOS `/var` → `/private/var`, mkdtemp-based tests)
 * and the self-exec silently does not run.
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
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry)
  } catch {
    return false
  }
}
