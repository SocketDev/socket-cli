/**
 * @file The tag-gap healer's SUBJECT resolution: which package, on which
 *   registry, this repo's cron should be reading. Split out of
 *   reconcile-gap.mts so one file owns the "what am I scanning" question and
 *   the other owns the gap math + the CLI.
 *   Two inputs decide it. The repo's DECLARED channels
 *   (`.config/repo/socket-wheelhouse.json`) say which registries it ships to,
 *   and the publish engine's own workspace layout says which package carries
 *   the version. Reading the ROOT package.json instead is what blinded this
 *   healer: a private workspace root looks registry-less, so the cron reported
 *   green while a published version sat untagged.
 *   DEPENDENCY-FREE BY DESIGN — node builtins plus the dep-0 leaves
 *   `_shared/release-channels.mts` and `publish-infra/npm/workspace.mts`, so
 *   the gap job can call it on a bare checkout before any pnpm install.
 */

import path from 'node:path'

import {
  HEALABLE_REGISTRY_CHANNEL,
  readDeclaredPublishChannels,
  unhealableRegistryChannels,
} from '../_shared/release-channels.mts'
import { resolveNpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'

/**
 * What the healer resolved to scan this run.
 *
 * - `npm` — the package name whose packument the gap set is computed from.
 * - `none` — a GENUINE no-op with its reason: the repo declares no registry
 *   channel at all, or its npm subject is private and therefore has no registry
 *   history to reconcile against.
 *
 * Anything else throws. There is no third "could not tell" state, because
 * that state is exactly how the healer went blind on decmpfs.
 */
export type GapSubject =
  | { kind: 'none'; reason: string }
  | { kind: 'npm'; name: string }

/**
 * The healer's subject, resolved from the repo's DECLARED channels plus the
 * publish engine's own workspace layout.
 *
 * The layout resolver is what makes a private workspace root work: decmpfs's
 * root is `private: true` with no `publishConfig.directory`, and its npm
 * subject is the `napi/decmpfs` workspace member. Reading the root manifest
 * alone sees `private` and self-skips — a green cron over an unhealed gap.
 * `resolveNpmWorkspaceLayout` classifies that repo `multi` and names the
 * member, exactly as the publish engine does, so healer and publisher can
 * never disagree about what this repo ships.
 *
 * Throws LOUD (What / Where / Saw-vs-wanted / Fix) when a declared npm
 * channel has no resolvable subject, and when the repo's only registry
 * channels are ones this healer has no arm for. Exported for tests.
 */
export function resolveGapSubject(repoRoot: string): GapSubject {
  const channels = readDeclaredPublishChannels(repoRoot)
  // An absent or unreadable member config predates the channel declaration;
  // npm is the historical assumption, so the healer still scans rather than
  // going quiet on a repo it used to cover.
  const npmDeclared =
    channels.length === 0 || channels.includes(HEALABLE_REGISTRY_CHANNEL)
  const unhealable = unhealableRegistryChannels(channels)
  if (!npmDeclared) {
    if (unhealable.length) {
      throw new Error(
        `The tag-gap healer has no arm for this repo's registry channel(s): ` +
          `${unhealable.join(', ')}.\n` +
          `  Where: ${path.join(repoRoot, '.config', 'repo', 'socket-wheelhouse.json')}\n` +
          `  Saw vs wanted: the declared publish channels are ` +
          `${channels.join(', ')}; the reconcile leg can only verify a ` +
          `${HEALABLE_REGISTRY_CHANNEL} version (it re-packs the content ` +
          `commit and compares the tarball against the packument's dist ` +
          `digests before cutting a tag). A published-but-untagged version on ` +
          `${unhealable.join(' / ')} would go unnoticed, so this run fails ` +
          `instead of reporting a clean cron.\n` +
          `  Fix: give the healer a ${unhealable.join(' / ')} arm ` +
          `(published-version read + a content check the reconcile leg can ` +
          `stand on), or declare the repo's npm channel if it also ships to ` +
          `npm.`,
      )
    }
    return {
      kind: 'none',
      reason:
        `no registry channel declared (${channels.join(', ') || 'no channels'}) ` +
        `— a tag gap needs a registry to be live on`,
    }
  }
  const layout = resolveNpmWorkspaceLayout(repoRoot)
  if (layout.kind === 'single' && layout.subject?.private === true) {
    return {
      kind: 'none',
      reason:
        `the npm subject ${layout.subject.name} is private — nothing of it ` +
        `is on the registry to reconcile against`,
    }
  }
  return { kind: 'npm', name: layout.versionSource.name }
}
