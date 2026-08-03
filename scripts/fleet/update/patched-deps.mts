/**
 * @file Stale `patchedDependencies` gate for the update engine. pnpm keys a
 *   patch as `<name>@<version>` → `patches/<name>@<version>.patch`; a version
 *   bump, catalog entry or override pin, that leaves the key on the OLD
 *   version strands every later `pnpm install` with ERR_PNPM_UNUSED_PATCH —
 *   and a half-state referencing a nonexistent patch file has already been
 *   committed once. The update engine therefore FAILS LOUD before the
 *   lockfile resync when any bumped pin no longer matches its patch key,
 *   telling the operator exactly which patch to re-key. Re-keying is never
 *   automated: whether a patch still applies to the new version needs the new
 *   tarball (network) plus human judgment on per-version ported code, so a
 *   silent auto-re-key could ship a wrong patch. Pure text analysis over the
 *   live pnpm-workspace.yaml — no network, no fs beyond the one file read in
 *   `findStalePatchKeysInFile`.
 */

import { existsSync, readFileSync } from 'node:fs'

import { parseWorkspaceBlock, pinnedVersionOf } from './fleet-pins.mts'

/**
 * A `<name>@<version>` key split into its parts. The version part is the text
 * after the LAST `@`, so scoped names (`@polka/url@1.0.0-next.29`) split
 * correctly; for override range keys (`string-width@>=5`) it holds the range.
 */
export interface VersionedKey {
  readonly name: string
  readonly version: string
}

/**
 * One `patchedDependencies` entry whose keyed version no longer matches every
 * resolved pin for that package — the exact state that dies later as
 * ERR_PNPM_UNUSED_PATCH.
 */
export interface StalePatchKey {
  readonly name: string
  readonly patchFile: string
  readonly patchKey: string
  readonly patchVersion: string
  readonly pinnedVersions: readonly string[]
}

/**
 * Split a `<name>@<version>` key on its LAST `@`. Returns `undefined` for a
 * bare-name key (no `@` past index 0) — pnpm allows those and they never go
 * stale. Pure.
 */
export function splitVersionedKey(key: string): VersionedKey | undefined {
  const at = key.lastIndexOf('@')
  if (at <= 0) {
    return undefined
  }
  const name = key.slice(0, at)
  const version = key.slice(at + 1)
  if (name === '' || version === '') {
    return undefined
  }
  return { name, version }
}

/**
 * True when `value` is a bare exact version (not an alias, protocol ref, or
 * range). Pure.
 */
export function isValidBareVersion(value: string): boolean {
  return pinnedVersionOf(value) === value
}

/**
 * Collect every exact version the workspace pins per package name, from the
 * `catalog:` block, bare versions, and the `overrides:` block (bare-version
 * values, range-scoped keys included; `catalog:` values resolve through the
 * catalog). Alias (`npm:`) values are skipped — they install a different
 * package under the name, so a patch key never matches them. Pure.
 */
export function collectResolvedPins(
  workspaceYamlText: string,
): Map<string, string[]> {
  const catalog = parseWorkspaceBlock(workspaceYamlText, 'catalog')
  const overrides = parseWorkspaceBlock(workspaceYamlText, 'overrides')
  const pins = new Map<string, string[]>()
  function add(name: string, version: string): void {
    const existing = pins.get(name)
    if (existing === undefined) {
      pins.set(name, [version])
    } else if (!existing.includes(version)) {
      existing.push(version)
    }
  }
  for (const [name, value] of catalog) {
    if (isValidBareVersion(value)) {
      add(name, value)
    }
  }
  for (const [key, value] of overrides) {
    const name = splitVersionedKey(key)?.name ?? key
    const resolved = value === 'catalog:' ? catalog.get(name) : value
    if (resolved !== undefined && isValidBareVersion(resolved)) {
      add(name, resolved)
    }
  }
  return pins
}

/**
 * Find every `patchedDependencies` key whose version no longer matches EVERY
 * resolved pin for its package. Any differing pin counts as stale: a scoped
 * override bumped past the patch key means the patched version stops
 * installing, which is exactly ERR_PNPM_UNUSED_PATCH later. Packages with no
 * exact pin, resolution driven by dependency ranges, are out of scope. Pure.
 */
export function findStalePatchKeys(workspaceYamlText: string): StalePatchKey[] {
  const patched = parseWorkspaceBlock(workspaceYamlText, 'patchedDependencies')
  if (patched.size === 0) {
    return []
  }
  const pins = collectResolvedPins(workspaceYamlText)
  const stale: StalePatchKey[] = []
  for (const [patchKey, patchFile] of patched) {
    const split = splitVersionedKey(patchKey)
    if (!split) {
      continue
    }
    const pinned = pins.get(split.name)
    if (pinned === undefined || pinned.every(v => v === split.version)) {
      continue
    }
    stale.push({
      name: split.name,
      patchFile,
      patchKey,
      patchVersion: split.version,
      pinnedVersions: pinned.toSorted(),
    })
  }
  return stale
}

/**
 * Read `workspaceYamlPath` and find its stale patch keys. Absent file → no
 * findings, a repo without a workspace file has no patches to strand.
 */
export function findStalePatchKeysInFile(
  workspaceYamlPath: string,
): StalePatchKey[] {
  if (!existsSync(workspaceYamlPath)) {
    return []
  }
  return findStalePatchKeys(readFileSync(workspaceYamlPath, 'utf8'))
}

/**
 * Render the fail-loud What/Where/Saw-vs-wanted/Fix report for stale patch
 * keys. Pure.
 */
export function formatStalePatchKeysError(
  stale: readonly StalePatchKey[],
): string {
  const lines = [
    `update: ${stale.length} patchedDependencies key(s) went stale — a version bump left the patch keyed to the old version, so the next \`pnpm install\` dies with ERR_PNPM_UNUSED_PATCH.`,
    '  Where: pnpm-workspace.yaml `patchedDependencies:`',
  ]
  for (let i = 0, { length } = stale; i < length; i += 1) {
    const s = stale[i]!
    lines.push(
      `  Saw: '${s.patchKey}' (${s.patchFile}) while '${s.name}' is now pinned to ${s.pinnedVersions.join(', ')}; wanted the patch key to match every pin.`,
    )
  }
  lines.push(
    '  Fix: re-key each patch for the new version — `pnpm patch <name>@<newVersion>`, re-apply the ported code from the old patches/<name>@<oldVersion>.patch, `pnpm patch-commit` (updating the patchedDependencies key + patch file name) — or revert the bump. Then re-run `pnpm run update`.',
  )
  return lines.join('\n')
}
