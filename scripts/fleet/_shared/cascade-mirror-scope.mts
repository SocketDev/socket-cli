/**
 * @file Live cascade-mirror payload scope — the paths a MUTATING fixer must
 *   never write. Every glob here names a LIVE copy of the fleet-canonical
 *   cascade payload: `scripts/fleet/**`, `.git-hooks/**`, `bootstrap/**`, the
 *   `.claude/*∕fleet/**` tiers, and so on. Those copies are gated at the
 *   template SOURCE — a member-side edit both violates the mirror discipline
 *   and is clobbered by the next cascade. Hit live: a `fix --all` wave edited
 *   200+ mirror files in socket-packageurl-js after a repo-tier oxlint config
 *   shadowed the canonical ignore block, so the mutation bar cannot depend on
 *   config plumbing — it is re-asserted here, on every mutating invocation.
 *   Every glob is ROOT-ANCHORED, never `**∕`-prefixed. That is the load-bearing
 *   difference from the canonical `ignorePatterns` mirror globs: the any-depth
 *   variants also match the wheelhouse's `template/base/**` sources, and the
 *   wheelhouse must keep fixing those via the dogfood + template-payload
 *   passes. Root anchoring makes the template exemption structural — no
 *   wheelhouse/member branch needed.
 *   Scope of the bar: MUTATION only. Read-only lint keeps its current gate
 *   design and may still report mirror findings; the fix is made at the
 *   template source and cascaded.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Keep in lock-step with the `#fleet-canonical-begin` ignore block in
// `.config/fleet/oxlintrc.json` — these are that block's mirror entries with
// the `**/` anchor stripped, minus the non-mirror artifacts the generated/
// vendored floors already own. Enforced by
// test/repo/unit/cascade-mirror-scope.test.mts in the wheelhouse.
export const CASCADE_MIRROR_GLOBS: readonly string[] = [
  '.claude/agents/fleet/**',
  '.claude/commands/fleet/**',
  '.claude/hooks/fleet/**',
  '.claude/skills/fleet/**',
  '.config/fleet/**',
  '.config/repo/rolldown/**',
  '.config/repo/vitest.config.mts',
  '.git-hooks/**',
  '.mcp.json',
  'bootstrap/**',
  'docs/agents.md/fleet/**',
  'scripts/fleet/**',
  'test/fleet/_shared/**',
  'test/fleet/scripts/**',
]

/**
 * True when `file` — repo-relative — is a live cascade-mirror payload path
 * that mutating fixers must skip. `template/base/**` sources never match: the
 * globs are root-anchored, so the wheelhouse canon stays fixable.
 */
export function isCascadeMirrorPath(file: string): boolean {
  const normalized = normalizePath(file)
  for (let i = 0, { length } = CASCADE_MIRROR_GLOBS; i < length; i += 1) {
    const glob = CASCADE_MIRROR_GLOBS[i]!
    if (glob.endsWith('/**')) {
      const base = glob.slice(0, -3)
      if (normalized === base || normalized.startsWith(`${base}/`)) {
        return true
      }
    } else if (normalized === glob) {
      return true
    }
  }
  return false
}

/**
 * CLI `--ignore-pattern` args barring oxlint MUTATION of the live mirrors.
 * oxlint roots CLI patterns at the cwd — the repo root — so these match only
 * the live copies, never `template/base/**`. Appended to `--fix` invocations
 * only; verify/report passes keep their configured scope.
 */
export function cascadeMirrorOxlintIgnoreArgs(): string[] {
  const args: string[] = []
  for (let i = 0, { length } = CASCADE_MIRROR_GLOBS; i < length; i += 1) {
    args.push('--ignore-pattern', CASCADE_MIRROR_GLOBS[i]!)
  }
  return args
}

/**
 * Positional `!`-exclude patterns barring oxfmt MUTATION of the live mirrors.
 * oxfmt applies positional excludes even to files passed explicitly on the
 * argv — unlike `--ignore-path`, which it skips for explicit files — so this
 * one mechanism covers both the whole-tree walk and the staged/explicit file
 * lanes. Appended to `--write` invocations and their convergence probes only.
 */
export function cascadeMirrorOxfmtExcludeArgs(): string[] {
  return CASCADE_MIRROR_GLOBS.map(glob => `!${glob}`)
}
