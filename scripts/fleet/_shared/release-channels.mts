/**
 * @file The repo's DECLARED release channels, read dep-0. A member declares
 *   where it publishes in `.config/repo/socket-wheelhouse.json`: the primary
 *   `build.from` plus every `secondaries[].from`. That declaration is what
 *   tells a release-side tool which registries a repo actually ships to — a
 *   crates-primary repo with an npm secondary (decmpfs) declares both, and a
 *   tool that only ever looks at package.json sees half the picture.
 *   Why not import the sync-scaffolding `publishChannels()` helper: that one
 *   is wheelhouse-owned (`scripts/repo/`), never cascaded to members, and it
 *   consumes an already-validated config object. This leaf is the cascaded,
 *   dep-0 read of the same field — node builtins only, so the
 *   release-reconcile gap job can call it on a bare checkout before any pnpm
 *   install. There is no duplicated DATA: the channel values live in the
 *   member's own config file, and this module only reads them.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * A registry channel the tag-gap healer can reconcile against. npm is the one
 * registry the reconcile leg can verify: it re-packs the content commit and
 * compares the tarball against the packument's dist digests before a tag is
 * cut. Any other `-registry` channel is out of the healer's reach.
 */
export const HEALABLE_REGISTRY_CHANNEL = 'npm-registry'

/**
 * Every publish channel the repo at `repoRoot` declares, primary first, then
 * secondaries in declared order, deduplicated. An absent, unreadable, or
 * malformed config yields an empty list — the caller decides what that means
 * rather than getting a silent default baked in here.
 */
export function readDeclaredPublishChannels(repoRoot: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.config', 'repo', 'socket-wheelhouse.json'),
        'utf8',
      ),
    )
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return []
  }
  const config = parsed as Record<string, unknown>
  const froms: string[] = []
  function addFrom(entry: unknown): void {
    if (typeof entry !== 'object' || entry === null) {
      return
    }
    const from = (entry as Record<string, unknown>)['from']
    if (typeof from === 'string' && from && !froms.includes(from)) {
      froms.push(from)
    }
  }
  addFrom(config['build'])
  const secondaries = config['secondaries']
  if (Array.isArray(secondaries)) {
    for (let i = 0, { length } = secondaries; i < length; i += 1) {
      addFrom(secondaries[i])
    }
  }
  return froms
}

/**
 * The declared registry channels the tag-gap healer has NO arm for — every
 * `-registry` channel that is not npm. Derived from the channel names rather
 * than a hand-kept map, so a future `go-registry` secondary is covered the
 * day it is declared. A repo that publishes ONLY through such a channel must
 * fail loud instead of reporting a clean cron: there is nothing the healer
 * can read to know whether a version is live but untagged.
 */
export function unhealableRegistryChannels(
  channels: readonly string[],
): string[] {
  return channels.filter(
    from => from.endsWith('-registry') && from !== HEALABLE_REGISTRY_CHANNEL,
  )
}
