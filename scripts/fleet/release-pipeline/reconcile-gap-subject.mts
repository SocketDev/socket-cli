/**
 * @file The tag-gap healer's SUBJECT resolution: which package, on which
 *   registry, this repo's cron should be reading. Split out of
 *   reconcile-gap.mts so one file owns the "what am I scanning" question and
 *   the other owns the gap math + the CLI.
 *   Three inputs decide it, in preference order. The repo's DECLARED channels
 *   (`.config/repo/socket-wheelhouse.json`) say which registries it ships to;
 *   the publish engine's own workspace layout says which package carries the
 *   version; and when the member config declares nothing, the root manifest's
 *   `private` flag and a root `Cargo.toml` say whether this repo is an npm
 *   publisher at all. Reading the ROOT package.json ALONE is what blinded this
 *   healer: a private workspace root looks registry-less, so the cron reported
 *   green while a published version sat untagged. Treating a missing npm
 *   subject as ALWAYS fatal is the opposite failure: a Rust member publishes
 *   nothing to npm, so the hourly cron went red on a legitimate shape.
 *   DEPENDENCY-FREE BY DESIGN — node builtins plus the dep-0 leaves
 *   `_shared/release-channels.mts` and `publish-infra/npm/workspace.mts`, so
 *   the gap job can call it on a bare checkout before any pnpm install.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  HEALABLE_REGISTRY_CHANNEL,
  readDeclaredPublishChannels,
  unhealableRegistryChannels,
} from '../_shared/release-channels.mts'
import {
  readManifest,
  resolveNpmWorkspaceLayout,
} from '../publish-infra/npm/workspace.mts'

import type { NpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'

/**
 * What the healer resolved to scan this run.
 *
 * - `npm` — the package name whose packument the gap set is computed from.
 * - `none` — no npm gap set to compute, carrying BOTH the reason and the status
 *   the cron should report it under. `skipped` is a genuine no-op (the repo
 *   declares it does not publish to npm, or its npm subject is private).
 *   `degraded` means a gap could exist and this run could not tell — the repo
 *   ships to a registry the healer has no arm for.
 *
 * Anything else throws. There is no third "could not tell" state hidden inside
 * `skipped`, because that state is exactly how the healer went blind on
 * decmpfs.
 */
export type GapSubject =
  | { kind: 'none'; reason: string; status: 'degraded' | 'skipped' }
  | { kind: 'npm'; name: string }

/**
 * The signal by which this repo DECLARES it does not publish to npm, as a
 * one-line reason naming that signal — or `undefined` when the repo carries no
 * such declaration, in which case a missing npm subject is a real
 * misconfiguration and must stay loud.
 *
 * Consulted only when the member config declares NO channels at all (a repo
 * mid-onboarding, or one whose marker the dep-0 channel reader cannot see).
 * The two fallback signals, in the order the fleet trusts them:
 *
 * 1. Root package.json `"private": true` — an explicit "this repo does not publish
 *    to npm".
 * 2. A root `Cargo.toml` — a Rust member whose package.json exists for JS tooling
 *    only.
 *
 * A root that redirects via `publishConfig.directory` is NEVER an opt-out: it
 * names an npm subject outright, so a redirect resolving nowhere stays loud.
 */
export function npmOptOutSignal(repoRoot: string): string | undefined {
  const rootManifestPath = path.join(repoRoot, 'package.json')
  const root = readManifest(rootManifestPath)
  if (root?.publishConfig?.directory !== undefined) {
    return undefined
  }
  const declareFix =
    `declare the repo's publish channels in ` +
    `${path.join('.config', 'repo', 'socket-wheelhouse.json')} so this is a ` +
    `declaration rather than an inference`
  if (root?.private === true) {
    return (
      `this repo declares it does not publish to npm — where: ` +
      `${rootManifestPath}; saw "private": true on the root manifest and no ` +
      `publishable workspace member under it, wanted a declared npm channel ` +
      `before a missing npm subject counts as a fault; fix: ${declareFix}`
    )
  }
  const cargoManifestPath = path.join(repoRoot, 'Cargo.toml')
  if (existsSync(cargoManifestPath)) {
    return (
      `this is a Cargo member with no npm package — where: ` +
      `${cargoManifestPath}; saw a root Cargo manifest and no publishable npm ` +
      `manifest, wanted a declared npm channel before a missing npm subject ` +
      `counts as a fault; fix: ${declareFix}`
    )
  }
  return undefined
}

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
 * Throws LOUD (What / Where / Saw-vs-wanted / Fix) when a repo that SHOULD
 * carry an npm package has no resolvable subject — either because it declares
 * an npm channel, or because it declares nothing and shows no sign of being a
 * non-npm member. That distinction is the whole point of `npmOptOutSignal`: a
 * Rust member with a private JS-tooling root is a legitimate fleet shape, not a
 * misconfiguration, and a healer that reds hourly on it just trains operators
 * to ignore CI. Exported for tests.
 */
export function resolveGapSubject(repoRoot: string): GapSubject {
  const channels = readDeclaredPublishChannels(repoRoot)
  const npmDeclared = channels.includes(HEALABLE_REGISTRY_CHANNEL)
  const unhealable = unhealableRegistryChannels(channels)
  if (channels.length && !npmDeclared) {
    if (unhealable.length) {
      // A crates-only / go-only member. The reconcile leg can only verify an
      // npm version, so a published-but-untagged crate is genuinely NOT
      // covered — but that is a standing limitation of the healer, not a fault
      // in this repo, and failing hourly over it is the false-red this job
      // must never produce. `degraded` is the honest status: it writes the job
      // summary and can never read as a verified-clean cron.
      return {
        kind: 'none',
        reason:
          `the tag-gap healer has no ${unhealable.join(' / ')} arm — where: ` +
          `${path.join(repoRoot, '.config', 'repo', 'socket-wheelhouse.json')}; ` +
          `saw declared publish channel(s) ${channels.join(', ')} with no ` +
          `${HEALABLE_REGISTRY_CHANNEL}, wanted a channel the reconcile leg ` +
          `can verify (it re-packs the content commit and compares the ` +
          `tarball against the packument's dist digests before cutting a ` +
          `tag), so a published-but-untagged ${unhealable.join(' / ')} ` +
          `version is NOT covered by this run; fix: give the healer a ` +
          `${unhealable.join(' / ')} arm, or declare the repo's npm channel ` +
          `if it also ships to npm`,
        status: 'degraded',
      }
    }
    return {
      kind: 'none',
      reason:
        `no registry channel declared (${channels.join(', ')}) ` +
        `— a tag gap needs a registry to be live on`,
      status: 'skipped',
    }
  }
  let layout: NpmWorkspaceLayout
  try {
    layout = resolveNpmWorkspaceLayout(repoRoot)
  } catch (e) {
    // The repo declares an npm channel, so a missing subject is a real
    // misconfiguration — the resolver's own loud error is the right outcome.
    if (npmDeclared) {
      throw e
    }
    // No declared channels at all. npm stays the historical assumption UNLESS
    // the repo shows it is not an npm publisher; without such a signal a
    // missing subject is still a fault and still fails loud.
    const optOut = npmOptOutSignal(repoRoot)
    if (!optOut) {
      throw e
    }
    return { kind: 'none', reason: optOut, status: 'skipped' }
  }
  if (layout.kind === 'single' && layout.subject?.private === true) {
    return {
      kind: 'none',
      reason:
        `the npm subject ${layout.subject.name} is private — nothing of it ` +
        `is on the registry to reconcile against`,
      status: 'skipped',
    }
  }
  return { kind: 'npm', name: layout.versionSource.name }
}
