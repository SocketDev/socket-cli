/**
 * @file Fleet policy (code-as-law): an `upstream/<name>` reference submodule
 *   pins the latest RELEASE TAG, not a moving branch. A tag is immutable, so
 *   the pin can't drift and advances deliberately with a fixture/proof; `main`
 *   / `releases/v6` float. Fails the `check --all` gate when an upstream
 *   block's `branch` is not a release tag (no `<major>.<minor>` version token),
 *   unless the block carries a `# no-release-tag: <reason>` annotation for an
 *   upstream that publishes no releases. Pure `.gitmodules` parse — no network,
 *   so offline/CI never flakes. No-ops when there is no `.gitmodules` or no
 *   `upstream/` submodule. See docs/agents.md/fleet/upstream-references.md.
 *   Usage: node scripts/fleet/check/upstream-submodules-are-release-tagged.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface UpstreamPin {
  name: string
  path: string
  branch: string | undefined
  noReleaseTag: boolean
}

// A release tag carries a `<major>.<minor>` version token: v0.4.5, 1.2.3,
// v6.0.2, a monorepo `@scope/pkg@1.2.3`, `pkg-v1.2.3`. A moving branch (main,
// master, develop, releases/v6, release/next) has no such `\d+\.\d+` token.
// Major-only floats (`v6`) intentionally fail — pin the full `v6.0.2`.
const RELEASE_TAG_RE = /\d+\.\d+/

/**
 * True when `branch` looks like an immutable release tag (has a
 * `<major>.<minor>` version token), false for a moving branch. Undefined/empty
 * is not a release tag.
 */
export function looksLikeReleaseTag(branch: string | undefined): boolean {
  return !!branch && RELEASE_TAG_RE.test(branch)
}

/**
 * Parse `.gitmodules` into the upstream-reference pins (path contains an
 * `upstream/` segment). Captures each block's `branch` and whether a
 * `# no-release-tag:` annotation appears in the comment line(s) immediately
 * preceding its header (the annotation belongs to the block it precedes, like
 * the `# <name>-<version>` header). Pure; order-preserving.
 */
export function parseUpstreamPins(gitmodules: string): UpstreamPin[] {
  const lines = gitmodules.split('\n')
  const pins: UpstreamPin[] = []
  let pendingNoRelease = false
  let cur: UpstreamPin | undefined
  const isUpstream = (name: string, p: string): boolean =>
    /(^|\/)upstream\//.test(p) || /(^|\/)upstream\//.test(name)
  const flush = (): void => {
    if (cur && isUpstream(cur.name, cur.path || cur.name)) {
      pins.push(cur)
    }
    cur = undefined
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const line = raw.trim()
    const header = /^\[submodule\s+"([^"]+)"\]$/.exec(line)
    if (header) {
      flush()
      cur = {
        name: header[1]!,
        path: header[1]!,
        branch: undefined,
        noReleaseTag: pendingNoRelease,
      }
      pendingNoRelease = false
      continue
    }
    if (line.startsWith('#')) {
      // A comment belongs to the block whose header FOLLOWS it (the annotation
      // sits above `[submodule …]`, like the `# <name>-<version>` header) — so
      // it is pending for the NEXT block, never the current one.
      if (/no-release-tag/i.test(line)) {
        pendingNoRelease = true
      }
      continue
    }
    if (line === '') {
      continue
    }
    if (cur) {
      // Matches a `.gitmodules` key = value line: group 1 is the key
      // (leading letter, then word chars/hyphens), group 2 is the raw value.
      const kv = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line)
      if (kv) {
        const key = kv[1]!.toLowerCase()
        const val = kv[2]!.trim()
        if (key === 'path') {
          cur.path = val
        } else if (key === 'branch') {
          cur.branch = val
        }
      }
    } else if (!line.startsWith('[')) {
      // stray non-comment top-level line resets a dangling pending annotation
      pendingNoRelease = false
    }
  }
  flush()
  return pins
}

/**
 * The upstream pins that VIOLATE the policy: `branch` is not a release tag and
 * the block has no `# no-release-tag:` escape.
 */
export function findViolations(pins: readonly UpstreamPin[]): UpstreamPin[] {
  return pins.filter(p => !p.noReleaseTag && !looksLikeReleaseTag(p.branch))
}

/**
 * Fail the gate when any `upstream/<name>` submodule pins a moving branch
 * instead of a release tag (absent the annotation). Returns the exit code
 * (0 = compliant / no .gitmodules / no upstream submodules, 1 = violation).
 */
export function runCheck(repoRoot: string): number {
  const gitmodulesPath = path.join(repoRoot, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    return 0
  }
  const pins = parseUpstreamPins(readFileSync(gitmodulesPath, 'utf8'))
  if (pins.length === 0) {
    return 0
  }
  const violations = findViolations(pins)
  if (violations.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[upstream-submodules-are-release-tagged] Upstream(s) pin a moving branch, not a release tag.',
      '',
      '  Fleet policy: an upstream reference pins the latest RELEASE TAG (immutable),',
      '  not a floating branch. Offenders (branch is not a `<major>.<minor>` tag):',
      ...violations.map(
        v => `    - ${v.path}: branch = ${v.branch ?? '(unset)'}`,
      ),
      '',
      '  Fix: re-pin each to the latest release tag, e.g.',
      '    git config -f .gitmodules submodule.<name>.branch v1.2.3',
      '    node scripts/fleet/gen/gitmodules-hash.mts --set <name> <tag-sha> --label <name>-v1.2.3',
      '  If the upstream publishes NO releases, keep the branch and annotate the',
      '  block:  # no-release-tag: <why>',
      '',
    ].join('\n'),
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = runCheck(REPO_ROOT)
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}
