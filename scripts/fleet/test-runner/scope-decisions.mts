/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file Pure scope-decision predicates for the fleet test runner
 *   (scripts/fleet/test.mts): whether a changed-file set forces the full suite
 *   (`shouldEscalate`) and whether a workspace layout delegates every scope to
 *   per-package scripts (`shouldDelegateWorkspace`). No I/O — inputs injected.
 */

// Paths that, when changed, force the full suite to run.
export const ESCALATION_PATTERNS = [
  // Discovery / resolution config only — a change here is invisible to the
  // module-graph walk, no source file imports it, yet changes which tests run
  // or how specifiers resolve, so the scoped run can't be trusted. An ordinary
  // source file under scripts/ or .config/ is NOT here: its tests are reachable
  // via `vitest related`, so escalating on it just runs the whole suite for
  // nothing.
  /(?:^|\/)vitest\.config\.(?:js|mjs|mts|ts)$/,
  /(?:^|\/)vitest\.json$/,
  /(?:^|\/)tsconfig.*\.json$/,
  /(?:^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /(?:^|\/)\.oxlintrc\.json$/,
  /(?:^|\/)\.oxfmtrc\.json$/,
  /^scripts\/fleet\/test\.mts$/,
  /(?:^|\/)test\/scripts\/(?:fleet|repo)\/setup\.mts$/,
  /^lockstep\.schema\.json$/,
]

export function shouldEscalate(files: string[]): boolean {
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    for (let i = 0, { length } = ESCALATION_PATTERNS; i < length; i += 1) {
      const pattern = ESCALATION_PATTERNS[i]!
      if (pattern.test(f)) {
        return true
      }
    }
  }
  return false
}

// Pre-commit is deliberately file-scoped even in a delegated workspace. Once
// hook packages are registered as workspace members, `pnpm -r run test` fans
// out across hundreds of hook manifests; a lockfile-only commit then spends
// its entire budget launching empty test processes. Full/changed runs retain
// per-package delegation and therefore keep package-specific env wrappers.
export function shouldDelegateWorkspace(
  scopeMode: string,
  config: { rootVitestConfigExists: boolean; workspaceManifestExists: boolean },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  return (
    scopeMode !== 'staged' &&
    !cfg.rootVitestConfigExists &&
    cfg.workspaceManifestExists
  )
}
