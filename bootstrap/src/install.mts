/*
 * @file Source module for the dep-0 fleet bundle installer: the install
 *   pipeline (files / segments / workspace-segment), package.json wiring, thin
 *   mode + stale-prune, and the settings / applied-ref readers. Built into the
 *   single distributed `bootstrap/fleet.mjs`. Dep-0: node: builtins + the
 *   lib-stable logger only (never the in-repo socket-lib).
 */

// socket-lint: allow source-method-order -- ordered by the install pipeline (files → segments → workspace → wire → thin → prune → settings), mirroring the dep-0 fetcher's call-flow rather than alphabetized.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node fetcher (documented invariant: never imports in-repo socket-lib): `git rm --cached` runs via node:child_process, and execFileSync's throw-on-nonzero is caught locally — the lib spawn wrapper (async, non-throwing) would re-plumb the error handling.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  beginMarker,
  endMarker,
  errorMessage,
  mergeWorkspaceYaml,
  normalizeBundlePath,
  segmentFileName,
  spliceFleetBlock,
  walkFiles,
} from './helpers.mts'
import type { BundleManifest, ThinOptions } from './helpers.mts'
import { mergeClaudeSettings } from './settings.mts'
import type { ClaudeSettings } from './settings.mts'

const logger = getDefaultLogger()

/**
 * Copy every verified byte-identical file from `filesDir` into `dest`,
 * creating parent directories as needed.
 */
export function installFiles(
  filesDir: string,
  dest: string,
  manifest: BundleManifest,
): void {
  for (const rel of Object.keys(manifest.files)) {
    const target = path.join(dest, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.join(filesDir, rel), target)
  }
}

/**
 * Apply each fleet-canonical segment: read the `.fleetblock` file, read the
 * consumer's existing file (or start with an empty string), splice the block
 * in, and write back.
 */
export function installSegments(
  segmentsDir: string,
  dest: string,
  manifest: BundleManifest,
): void {
  const segments = manifest.segments
  if (!segments || segments.length === 0) {
    return
  }
  for (const entry of segments) {
    const destName = segmentFileName(entry.path)
    const blockPath = path.join(segmentsDir, destName)
    const fleetBlock = readFileSync(blockPath, 'utf8')
    const targetPath = path.join(dest, entry.path)
    const existing = existsSync(targetPath)
      ? readFileSync(targetPath, 'utf8')
      : ''
    const updated = spliceFleetBlock({
      commentStyle: entry.commentStyle,
      fleetBlock,
      target: existing,
    })
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, updated)
  }
}

/**
 * Merge the release's canonical Claude settings section into the consumer's
 * hybrid file. Fleet keys are replaced; repo-owned top-level settings and
 * `.claude/hooks/repo/` registrations survive. Malformed JSON fails closed.
 */
export function installSettingsSegment(
  segmentsDir: string,
  dest: string,
  manifest: BundleManifest,
): number {
  const segment = manifest.settingsSegment
  if (segment === undefined) {
    return 0
  }
  const sourcePath = path.join(segmentsDir, segmentFileName(segment.path))
  if (!existsSync(sourcePath)) {
    logger.log(
      `install-fleet: Claude settings segment missing at ${sourcePath} — refusing to merge.`,
    )
    return 1
  }
  const targetPath = path.join(dest, segment.path)
  try {
    const fleetSettings = JSON.parse(
      readFileSync(sourcePath, 'utf8'),
    ) as ClaudeSettings
    const repoSettings = existsSync(targetPath)
      ? (JSON.parse(readFileSync(targetPath, 'utf8')) as ClaudeSettings)
      : undefined
    const merged = mergeClaudeSettings({ fleetSettings, repoSettings })
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, `${JSON.stringify(merged, undefined, 2)}\n`)
    return 0
  } catch (e) {
    logger.log(
      `install-fleet: Claude settings merge failed for ${targetPath}: ${errorMessage(e)}. Nothing written.`,
    )
    return 1
  }
}

/**
 * If the manifest includes a `workspaceSegment`, merge the fleet-managed
 * sections into the consumer's `pnpm-workspace.yaml`. Returns 0 on success,
 * 1 on any error (fail-closed).
 */
export function installWorkspaceSegment(
  segmentsDir: string,
  dest: string,
  manifest: BundleManifest,
): number {
  const ws = manifest.workspaceSegment
  if (ws === undefined) {
    return 0
  }
  const fleetFile = path.join(segmentsDir, 'pnpm-workspace.yaml.fleet')
  if (!existsSync(fleetFile)) {
    logger.log(
      `install-fleet: workspace segment file missing at ${fleetFile} — skipping workspace merge`,
    )
    return 0
  }
  const bundleFleetSections = readFileSync(fleetFile, 'utf8')
  const targetPath = path.join(dest, 'pnpm-workspace.yaml')
  const consumerYaml = existsSync(targetPath)
    ? readFileSync(targetPath, 'utf8')
    : ''
  try {
    const merged = mergeWorkspaceYaml({
      bundleFleetSections,
      consumerYaml,
      fleetKeys: ws.fleetKeys,
    })
    writeFileSync(targetPath, merged)
  } catch (e) {
    logger.log(
      `install-fleet: pnpm-workspace.yaml merge failed — ${errorMessage(e)}. Nothing written.`,
    )
    return 1
  }
  return 0
}

// The full manual re-fetch script + the idempotent `prepare` BELT. The belt is
// the dep-0 prepare DOCTOR (`bootstrap/prepare.mts`): it runs the if-current
// fetch, repairs pnpm-workspace.yaml's workspace dirs, then reconciles the
// install — the post-install repairs the first install couldn't do. Exported so
// the enforcement check (a thin member must carry the belt) tests against the
// exact strings, not a copy.
export const SYNC_FLEET_SCRIPT = 'node bootstrap/fleet.mjs'
export const PREPARE_FETCH = 'node bootstrap/prepare.mts'
// The read-only lock-step status verb (mise-outdated style). NEVER mutates —
// reports Pinned | Landed | Newest + an exit code. Wired beside `sync-fleet` so
// a member can ask "am I in lock-step?" without a fetch.
export const FLEET_STATUS_SCRIPT = 'node bootstrap/fleet.mjs --status'

/**
 * Wire the consumer's package.json for thin distribution: a `sync-fleet` script
 * (manual full re-fetch) and the `prepare` BELT — the idempotent auto-fetch
 * prepended so a fresh clone / CI `pnpm install` repopulates the untracked
 * fleet payload BEFORE the (itself-untracked) install-git-hooks step + any
 * chained build runs. Idempotent: skips when both are already in place. No-ops
 * if package.json is absent. (Dep-0 file — raw JSON, not EditablePackageJson.)
 */
export function wirePackageJson(dest: string): void {
  const pkgPath = path.join(dest, 'package.json')
  if (!existsSync(pkgPath)) {
    logger.log(
      `install-fleet: --wire: no package.json at ${pkgPath} — skipping`,
    )
    return
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<
    string,
    unknown
  >
  const scripts = (pkg['scripts'] ?? {}) as Record<string, string>
  let changed = false
  if (scripts['sync-fleet'] !== SYNC_FLEET_SCRIPT) {
    scripts['sync-fleet'] = SYNC_FLEET_SCRIPT
    changed = true
  }
  if (scripts['fleet:status'] !== FLEET_STATUS_SCRIPT) {
    scripts['fleet:status'] = FLEET_STATUS_SCRIPT
    changed = true
  }
  // Prepend the belt to `prepare`. The fetch MUST run first (install-git-hooks
  // and any build step are untracked in a thin repo, so they're absent until
  // the fetch lands them).
  const prepare = scripts['prepare']
  if (!prepare) {
    scripts['prepare'] = PREPARE_FETCH
    changed = true
  } else if (!prepare.startsWith(PREPARE_FETCH)) {
    scripts['prepare'] = `${PREPARE_FETCH} && ${prepare}`
    changed = true
  }
  if (!changed) {
    return
  }
  pkg['scripts'] = scripts
  writeFileSync(pkgPath, `${JSON.stringify(pkg, undefined, 2)}\n`)
}

export function normalizeManifestEntryPath(entry: { path: string }): string {
  return normalizeBundlePath(entry.path)
}

export interface FleetFileManifest {
  files: Record<string, string>
  segments?: ReadonlyArray<{ path: string }> | undefined
  settingsSegment?: { path: string } | undefined
}

/**
 * Compute the gitignore entries for thin mode — the wholly-fleet files that the
 * download/fetch action supplies, so they need not be git-tracked. Hybrid paths
 * (manifest.segments — CLAUDE.md, pnpm-workspace.yaml, …) are merged per repo
 * and stay tracked, so they're excluded.
 *
 * EVERY entry is EXPLICIT — one line per bundle file, never a blanket
 * `…/fleet/` dir entry. A dir blanket also swallows any future non-bundle
 * file that lands beside the payload, hiding it from git entirely; the
 * explicit list ignores exactly what the bundle supplies and nothing else.
 * The dir-level collapse still exists for the sync-prune walk — see
 * fleetDirRoots().
 */
export function thinIgnoreEntries(manifest: FleetFileManifest): string[] {
  const hybridPaths = new Set(
    (manifest.segments ?? []).map(normalizeManifestEntryPath),
  )
  if (manifest.settingsSegment !== undefined) {
    hybridPaths.add(normalizeBundlePath(manifest.settingsSegment.path))
  }
  const entries = new Set<string>()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i]!)
    if (hybridPaths.has(p)) {
      continue
    }
    entries.add(p)
  }
  return [...entries].toSorted()
}

/**
 * The wholly-fleet DIRECTORY roots — each `fleet/` tier a bundle file sits
 * under (`.claude/hooks/fleet/`, `.config/fleet/`, `scripts/fleet/`, …). The
 * sync-prune walks these so an on-disk file the current bundle dropped is
 * deleted. The `fleet/` convention guarantees each root holds only fleet
 * files (the member's own live beside it under `repo/`), so the walk can
 * never touch repo-owned content. The .gitignore block deliberately does NOT
 * use these — its entries are explicit per-file (thinIgnoreEntries).
 */
export function fleetDirRoots(manifest: FleetFileManifest): string[] {
  const hybridPaths = new Set(
    (manifest.segments ?? []).map(normalizeManifestEntryPath),
  )
  if (manifest.settingsSegment !== undefined) {
    hybridPaths.add(normalizeBundlePath(manifest.settingsSegment.path))
  }
  const roots = new Set<string>()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i]!)
    if (hybridPaths.has(p)) {
      continue
    }
    const parts = p.split('/')
    const fleetIdx = parts.indexOf('fleet')
    if (fleetIdx >= 0) {
      roots.add(`${parts.slice(0, fleetIdx + 1).join('/')}/`)
    }
  }
  return [...roots].toSorted()
}

/**
 * Apply thin mode: write a fleet-managed `.gitignore` block listing the
 * wholly-fleet bundle paths (see thinIgnoreEntries) plus `.agents/`, then
 * untrack them from git so the fetch action repopulates them going forward.
 */
export function applyThinMode(options: ThinOptions): void {
  const opts = { __proto__: null, ...options } as ThinOptions
  const { dest, manifest } = opts

  const sortedRoots = thinIgnoreEntries(manifest)

  // Build the gitignore block content. `.agents/` is the regenerated agent
  // mirror — dead weight in a thin consumer (the fetch repopulates it), so
  // untrack it too. The dep-0 bootstrap (`bootstrap/`) is NOT listed: it ships
  // via the manual cascade, never the release bundle, so it never enters this
  // untrack set and stays tracked by default.
  const blockLines = ['.agents/', ...sortedRoots]
  const fleetBlock = [
    beginMarker('hash'),
    ...blockLines,
    endMarker('hash'),
  ].join('\n')

  // Splice into .gitignore (create if absent).
  const gitignorePath = path.join(dest, '.gitignore')
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : ''
  const updated = spliceFleetBlock({
    commentStyle: 'hash',
    fleetBlock,
    target: existing,
  })
  writeFileSync(gitignorePath, updated)

  // Untrack the fleet payload + the dead `.agents/` mirror from git (non-fatal
  // if git rm fails — e.g. a path that was never tracked). `--ignore-unmatch`
  // tolerates entries absent from the index.
  const rmTargets = ['.agents/', ...sortedRoots]
  if (rmTargets.length > 0) {
    try {
      execFileSync(
        'git',
        ['rm', '-r', '--cached', '--ignore-unmatch', ...rmTargets],
        { cwd: dest, stdio: 'inherit' },
      )
    } catch (e) {
      logger.log(
        `install-fleet: --thin: git rm --cached failed (non-fatal) — ${errorMessage(e)}`,
      )
    }
  }
}

// On-disk files under a fleet root the prune must NEVER delete: OS noise (the
// same set gitignore-fleet-block.mts manages). The applied-ref marker now lives
// under node_modules/.cache/ (outside any pruned fleet root), so it no longer
// needs an entry here.
const PRUNE_SKIP_NAMES = new Set(['._.DS_Store', '.DS_Store', 'Thumbs.db'])

/**
 * Prune stale fleet files so a fetch is a true SYNC (place + prune), not just
 * an additive copy. After the bundle is placed, any on-disk file under a
 * wholly-fleet DIR root (the `…/fleet/` tiers thinIgnoreEntries collapses) that
 * the current bundle does NOT contain is deleted — so a fleet file a later
 * bundle no longer ships does not linger as cruft on a member. Only those
 * fleet-owned roots are walked; hybrid segments, carve-outs, and repo-owned
 * files live outside them and are never touched. Normal-ignore files
 * (PRUNE_SKIP_NAMES) are left alone — they are local, not bundle payload.
 */
export function pruneStaleFleetFiles(
  dest: string,
  manifest: FleetFileManifest,
): number {
  const kept = new Set(Object.keys(manifest.files).map(normalizeBundlePath))
  for (const segment of manifest.segments ?? []) {
    kept.add(normalizeBundlePath(segment.path))
  }
  if (manifest.settingsSegment !== undefined) {
    kept.add(normalizeBundlePath(manifest.settingsSegment.path))
  }
  let pruned = 0
  // Only the wholly-fleet DIR roots can hold on-disk files the current bundle
  // dropped (an explicit ignore entry is itself a manifest file → never
  // stale), so the walk uses fleetDirRoots, not the per-file ignore list.
  const roots = fleetDirRoots(manifest)
  for (let r = 0, { length: rootCount } = roots; r < rootCount; r += 1) {
    const root = roots[r]!
    const dirAbs = path.join(dest, root)
    if (!existsSync(dirAbs)) {
      continue
    }
    for (const rel of walkFiles(dirAbs, dest)) {
      if (PRUNE_SKIP_NAMES.has(path.basename(rel))) {
        continue
      }
      // walkFiles returns OS-separated paths; manifest keys are '/'-joined.
      const key = normalizeBundlePath(rel)
      if (!kept.has(key)) {
        rmSync(path.join(dest, rel), { force: true })
        pruned += 1
      }
    }
  }
  return pruned
}

// The member's wheelhouse settings file — the single member-owned config
// surface (repo identity + the pinned bundle ref). Relative to <dest>.
const SETTINGS_PATH = '.config/socket-wheelhouse.json'
// Local cache marker recording the ref of the last-applied bundle. Lives under
// node_modules/.cache/ — the standard tool-cache location: gitignored via
// node_modules (so it never dirties the worktree), and reachable dep-free at
// prepare time. This file is dep-0 (it runs before socket-lib's cacache exists),
// so it can't use cacache; node_modules/.cache/<name> is the dep-0 equivalent —
// out of the repo tree, no .gitignore rule needed. A fresh clone / CI has no
// node_modules/.cache, so the fetch runs; `--if-current` reads it to skip a
// redundant warm fetch in local dev. See
// docs/agents.md/fleet/runtime-state-and-caches.md.
const APPLIED_MARKER = 'node_modules/.cache/socket-wheelhouse/bundle-applied'
// An in-tree marker path under .config/fleet/. writeAppliedRef removes it if a
// consumer carries one, keeping the applied-ref state out of the tracked tree
// (it belongs under node_modules/.cache/, alongside APPLIED_MARKER).
const LEGACY_APPLIED_MARKER = '.config/fleet/.bundle-applied'

/**
 * Default bundle ref for a member — `bundle.ref` in its wheelhouse settings
 * file. Lets install-fleet (and the prepare/CI wires) omit an explicit --ref so
 * the pin lives in exactly one place. Returns undefined when absent/malformed.
 */
export function readBundleRef(dest: string): string | undefined {
  const p = path.join(dest, SETTINGS_PATH)
  if (!existsSync(p)) {
    return undefined
  }
  try {
    const json = JSON.parse(readFileSync(p, 'utf8')) as {
      bundle?: { ref?: string | undefined } | undefined
    }
    return json.bundle?.ref
  } catch {
    return undefined
  }
}

export interface BundleConfig {
  readonly ref: string | undefined
  readonly cascadeSha: string | undefined
}

/**
 * Read the member's full pinned `bundle` block (ref + cascadeSha) from the
 * wheelhouse settings file. The lock-step verify + the `fleet:status` verb need
 * BOTH halves — `readBundleRef` returns only the ref for the fetch default.
 * Returns both as undefined when the file is absent / malformed.
 */
export function readBundleConfig(dest: string): BundleConfig {
  const p = path.join(dest, SETTINGS_PATH)
  if (!existsSync(p)) {
    return { ref: undefined, cascadeSha: undefined }
  }
  try {
    const json = JSON.parse(readFileSync(p, 'utf8')) as {
      bundle?:
        | { ref?: string | undefined; cascadeSha?: string | undefined }
        | undefined
    }
    return {
      cascadeSha: json.bundle?.cascadeSha,
      ref: json.bundle?.ref,
    }
  } catch {
    return { ref: undefined, cascadeSha: undefined }
  }
}

export function readAppliedRef(dest: string): string | undefined {
  const p = path.join(dest, APPLIED_MARKER)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : undefined
}

export function writeAppliedRef(dest: string, ref: string): void {
  const p = path.join(dest, APPLIED_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, `${ref}\n`)
  // Remove the in-tree marker if a thin consumer carries one, so the applied-ref
  // state lives only under node_modules/.cache/ (out of the tracked tree).
  const legacy = path.join(dest, LEGACY_APPLIED_MARKER)
  if (existsSync(legacy)) {
    rmSync(legacy, { force: true })
  }
}
