#!/usr/bin/env node
/*
 * @file Commit-time dedup gate — the code-as-law surface the
 *   `deduping-dependencies` skill cites. Parses `pnpm-lock.yaml` and reports
 *   two avoidable shapes the dedup decision tree is meant to eliminate:
 *
 *   1. CROSS-MAJOR DUPLICATES — a package resolved at more than one distinct
 *      major version in the install tree. Each extra major is dead weight
 *      (more bytes, more attack surface, bigger bundles). The skill's decision
 *      tree classifies whether a given family is collapsible; this gate just
 *      surfaces the family so it can't silently re-accumulate.
 *   2. UN-REDIRECTED DROP-INS — a package that has a known
 *      `@socketregistry/<name>` hardened drop-in yet still resolves from npm
 *      under its own bare name. The drop-in universe is learned from the
 *      RESOLVED world: every `@socketregistry/*` name the lockfile mentions
 *      (override values, resolved package keys, importer specifiers) plus the
 *      cascaded fleet catalog (`.config/fleet/pnpm-workspace.fleet.yaml`).
 *      pnpm rewrites every matching resolution when a redirect override is
 *      present, so a surviving bare package key IS a missing redirect — ranged
 *      overrides that let an old major escape included. A `@socketregistry/*`
 *      drop-in is Socket-published + audited + API-transparent and
 *      soak-exempt, so an un-redirected copy is a free hardening + dedup win
 *      left on the table.
 *
 *   The judgment (which collapse is safe — format-flip vs API break, the
 *   consumer-grep) stays in the skill; this is the mechanical scan only.
 *
 *   Cross-major enforcement is AUTO-GATED on rolldown — not a config opt-in and
 *   no "reviewed" escape list: a repo that bundles with rolldown pays real bytes
 *   for every duplicate major, so the bar is ZERO dups. But it is ZERO dups in
 *   the PRODUCTION dependency closure only — the set of resolved packages an
 *   importer's `dependencies:`/`optionalDependencies:` roots actually reach
 *   through the snapshot graph, i.e. what can reach a bundle. A repo with no
 *   runtime `dependencies` (all tooling lives in `devDependencies`) has an
 *   empty closure, so its dev/test/publish-only duplicate majors (arborist,
 *   pacote, cacache, yargs, …) stay informational even when rolldown is
 *   present — they never enter bundle bytes. Any cross-major family INSIDE the
 *   closure is a hard failure there — collapse it (force the format-flips,
 *   `pnpm patch`-and-force the API-breaks). Rolldown use is detected from a
 *   rolldown (dev)dependency OR a rolldown config file (scripts/plugins that
 *   bundle). A non-bundling repo keeps the cross-major report informational
 *   (exit 0). A missing `@socketregistry` redirect is always a hard failure
 *   (the redirect is safe to add). No-ops when `pnpm-lock.yaml` is absent.
 *   Exit codes:
 *
 *   - 0 — no missing `@socketregistry` redirect, and (rolldown repo) zero
 *     cross-major duplicates in the production closure.
 *   - 1 — a missing `@socketregistry` redirect, or a cross-major duplicate in
 *     the production closure of a rolldown repo.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { FLEET_CATALOG_YAML, PNPM_LOCK } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

// A `packages:` (or `snapshots:`) key: `'<name>@<version>':` where name may be
// scoped (`@scope/pkg`). Indented exactly two spaces under the section header.
const PACKAGE_KEY_RE =
  /^ {2}'?((?:@[^@/'\s]+\/)?[^@'\s]+)@([^'\s(]+)(?:\([^)]*\))*'?:\s*$/
// Every `@socketregistry/<name>` mention in a text — override values
// (`npm:@socketregistry/x@1`), resolved package keys
// (`'@socketregistry/x@1.0.0':`), importer specifiers, catalog entries. The
// captured <name> is the drop-in's basename; socket-registry publishes each
// drop-in under its upstream package's name (a scoped upstream `@scope/pkg`
// is encoded `scope__pkg`).
const SOCKET_REGISTRY_NAME_RE = /@socketregistry\/([A-Za-z0-9._-]+)/g

export interface DuplicateFamily {
  name: string
  majors: string[]
}

export interface UnredirectedDropIn {
  name: string
  dropIn: string
}

export interface ScanResult {
  bundledDuplicates: DuplicateFamily[]
  duplicates: DuplicateFamily[]
  unredirected: UnredirectedDropIn[]
}

// Rolldown config filenames a repo bundles from — scripts/plugins that use
// rolldown even without a direct package.json dep. Checked at repo root and
// under `.config/{fleet,repo}/`.
const ROLLDOWN_CONFIG_BASENAMES: readonly string[] = [
  'rolldown.config.mts',
  'rolldown.config.ts',
  'rolldown.config.mjs',
  'rolldown.config.js',
]

// True when the repo bundles with rolldown — a rolldown (dev)dependency, OR a
// rolldown config file used by its scripts/plugins. Either way it ships bundled
// output where every duplicate major costs real bytes, so dedup enforcement
// auto-activates — no opt-in flag, no config.
export function repoUsesRolldown(repoRoot: string): boolean {
  let pkgRaw: string | undefined
  try {
    pkgRaw = readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
  } catch {
    pkgRaw = undefined
  }
  if (pkgRaw) {
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string> | undefined
      devDependencies?: Record<string, string> | undefined
    }
    if (pkg.dependencies?.['rolldown'] ?? pkg.devDependencies?.['rolldown']) {
      return true
    }
  }
  const dirs = [
    repoRoot,
    path.join(repoRoot, '.config', 'fleet'),
    path.join(repoRoot, '.config', 'repo'),
  ]
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    for (let j = 0, n = ROLLDOWN_CONFIG_BASENAMES.length; j < n; j += 1) {
      if (existsSync(path.join(dirs[i]!, ROLLDOWN_CONFIG_BASENAMES[j]!))) {
        return true
      }
    }
  }
  return false
}

// Reduce a semver-ish version string to its major component. A `0.x` package
// treats the MINOR as the breaking axis (semver's pre-1.0 rule), so
// `0.30.21` → `0.30` while `7.8.1` → `7`. Keeps a bare/odd version intact.
export function majorOf(version: string): string {
  const parts = version.split('.')
  const first = parts[0] ?? version
  if (first === '0' && parts.length > 1) {
    return `0.${parts[1]}`
  }
  return first
}

// A resolved version is semver-shaped when it starts with a digit. Git / tarball
// URL resolutions (`https://….tar.gz`, `git+ssh://…`) and other non-registry
// sources are NOT npm majors — they are source-pinned deps (e.g. a
// `packages/npm/<pkg>` drop-in testing against its upstream git tarball) that
// never reach the rolldown bundle, so they must not count toward cross-major
// dedup. Filtering them keeps the analysis to real registry majors.
export function isSemverVersion(version: string): boolean {
  return /^\d/.test(version)
}

// Collect every `<name>@<version>` key under a top-level section (`packages:`
// or `snapshots:`), returning name → set of distinct versions.
function collectResolvedVersions(lines: string[]): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>()
  let inSection = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'packages:' || line === 'snapshots:') {
      inSection = true
      continue
    }
    // A new unindented top-level key ends the section.
    if (inSection && /^[A-Za-z_]/.test(line)) {
      inSection = false
      continue
    }
    if (!inSection) {
      continue
    }
    const m = PACKAGE_KEY_RE.exec(line)
    if (!m) {
      continue
    }
    const name = m[1]!
    const version = m[2]!
    let versions = byName.get(name)
    if (!versions) {
      versions = new Set<string>()
      byName.set(name, versions)
    }
    versions.add(version)
  }
  return byName
}

// A 4-space dependency-kind header inside an importer or a snapshot entry
// (`dependencies:`, `devDependencies:`, `optionalDependencies:`, …) — shared
// by both, since pnpm nests both shapes at the same two levels.
const DEPENDENCY_KIND_RE = /^ {4}(?!\s)([A-Za-z]+):\s*$/
// A 6-space `<name>:` importer dependency entry with no inline value — its
// resolved version lives on the nested `version:` line below it.
const IMPORTER_DEP_NAME_RE = /^ {6}(?!\s)'?([^'\n]+?)'?:\s*$/
// The 8-space `version:` line under an importer dependency entry.
const IMPORTER_DEP_VERSION_RE = /^ {8}(?!\s)version:\s*(.+)$/
// A 2-space `<path>:` importer key with no inline value — the boundary
// between one importer's dependency blocks and the next.
const IMPORTER_KEY_RE = /^ {2}\S.*:\s*$/
// A 6-space `<name>: <version>` snapshot child dependency — inline value.
const SNAPSHOT_CHILD_RE = /^ {6}(?!\s)'?([^'\n]+?)'?:\s*(.+)$/

// Strip a YAML scalar's surrounding single quotes, if present.
function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    value[0] === "'" &&
    value[value.length - 1] === "'"
  ) {
    return value.slice(1, -1)
  }
  return value
}

// Strip a peer-suffix parenthetical (`(peer@1.0.0)`, possibly repeated) from a
// resolved version-field VALUE — the value-side counterpart of what
// `PACKAGE_KEY_RE` already strips from a resolved package KEY.
function stripPeerSuffix(value: string): string {
  const index = value.indexOf('(')
  return index === -1 ? value : value.slice(0, index)
}

// Reduce an importer/snapshot dependency's `<name>` plus its raw version-field
// VALUE to the resolved root key `<name>@<version>`. A pnpm `npm:` alias
// rewrites the VALUE to the redirect target's own `<realName>@<version>`
// (e.g. `gopd:` resolving to `@socketregistry/gopd@1.0.7`) instead of a bare
// version — detected by an `@` surviving the peer-suffix strip, since a bare
// semver or URL version never contains one.
function resolveRootKey(name: string, rawValue: string): string {
  const base = stripPeerSuffix(stripQuotes(rawValue.trim()))
  return base.includes('@') ? base : `${name}@${base}`
}

// Collect every importer's PRODUCTION dependency root — `dependencies:` and
// `optionalDependencies:` entries only, never `devDependencies:` /
// `peerDependencies:` / `configDependencies:` / `packageManagerDependencies:`.
// These are the entry points a rolldown bundle can actually reach; anything
// only rooted from a dev/peer/config block never ships in bundle bytes.
function collectImporterProdRoots(lines: readonly string[]): Set<string> {
  const roots = new Set<string>()
  let inImporters = false
  let inProdSection = false
  let pendingName: string | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'importers:') {
      inImporters = true
      continue
    }
    // A new unindented top-level key ends the section.
    if (inImporters && /^[A-Za-z_]/.test(line)) {
      inImporters = false
      continue
    }
    if (!inImporters) {
      continue
    }
    if (IMPORTER_KEY_RE.test(line)) {
      inProdSection = false
      pendingName = undefined
      continue
    }
    const kindMatch = DEPENDENCY_KIND_RE.exec(line)
    if (kindMatch) {
      const kind = kindMatch[1]!
      inProdSection = kind === 'dependencies' || kind === 'optionalDependencies'
      pendingName = undefined
      continue
    }
    if (!inProdSection) {
      continue
    }
    if (pendingName) {
      const versionMatch = IMPORTER_DEP_VERSION_RE.exec(line)
      if (versionMatch) {
        roots.add(resolveRootKey(pendingName, versionMatch[1]!))
        pendingName = undefined
        continue
      }
    }
    const nameMatch = IMPORTER_DEP_NAME_RE.exec(line)
    if (nameMatch) {
      pendingName = nameMatch[1]!
    }
  }
  return roots
}

// Build the snapshot dependency graph: resolved key → the resolved keys of
// its `dependencies:` + `optionalDependencies:` children. `devDependencies:` /
// `peerDependencies:` edges are excluded — a rolldown bundle only walks the
// production edges pnpm actually installs.
function collectSnapshotGraph(
  lines: readonly string[],
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  let inSection = false
  let currentKey: string | undefined
  let inProdSection = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'snapshots:') {
      inSection = true
      continue
    }
    // A new unindented top-level key ends the section.
    if (inSection && /^[A-Za-z_]/.test(line)) {
      inSection = false
      continue
    }
    if (!inSection) {
      continue
    }
    const keyMatch = PACKAGE_KEY_RE.exec(line)
    if (keyMatch) {
      currentKey = `${keyMatch[1]}@${keyMatch[2]}`
      if (!graph.has(currentKey)) {
        graph.set(currentKey, new Set())
      }
      inProdSection = false
      continue
    }
    if (!currentKey) {
      continue
    }
    const kindMatch = DEPENDENCY_KIND_RE.exec(line)
    if (kindMatch) {
      const kind = kindMatch[1]!
      inProdSection = kind === 'dependencies' || kind === 'optionalDependencies'
      continue
    }
    if (!inProdSection) {
      continue
    }
    const childMatch = SNAPSHOT_CHILD_RE.exec(line)
    if (childMatch) {
      graph.get(currentKey)!.add(resolveRootKey(childMatch[1]!, childMatch[2]!))
    }
  }
  return graph
}

// The set of every `<name>@<version>` reachable from a PRODUCTION importer
// root through the snapshot graph — what a rolldown bundle can actually pull
// in. Dev/test/publish-only tooling (arborist, pacote, cacache, yargs, …) that
// no importer's `dependencies:`/`optionalDependencies:` ever roots is
// excluded, even when it resolves at multiple majors.
export function collectProductionClosure(lines: string[]): Set<string> {
  const graph = collectSnapshotGraph(lines)
  const visited = new Set<string>()
  const queue = [...collectImporterProdRoots(lines)]
  while (queue.length > 0) {
    const key = queue.pop()!
    if (visited.has(key)) {
      continue
    }
    visited.add(key)
    const children = graph.get(key)
    if (children) {
      for (const child of children) {
        queue.push(child)
      }
    }
  }
  return visited
}

// Decode a drop-in basename back to the upstream package name it hardens
// (socket-registry's `scope__pkg` encoding for scoped upstreams).
function upstreamNameOf(dropIn: string): string {
  const sep = dropIn.indexOf('__')
  if (sep > 0) {
    return `@${dropIn.slice(0, sep)}/${dropIn.slice(sep + 2)}`
  }
  return dropIn
}

// Harvest the drop-in universe — every `@socketregistry/<name>` mentioned in
// the given texts. Textual on purpose: the lockfile mentions drop-ins in
// override values, resolved package keys, and importer specifiers, and the
// fleet catalog in entry keys and npm: alias values; all of them attest that
// `@socketregistry/<name>` exists as a published hardened package.
function collectDropInUniverse(texts: readonly string[]): Set<string> {
  const universe = new Set<string>()
  for (const text of texts) {
    for (const m of text.matchAll(SOCKET_REGISTRY_NAME_RE)) {
      universe.add(m[1]!)
    }
  }
  return universe
}

// Group a name → resolved-versions map into cross-major duplicate families,
// counting only the versions `isIncluded` accepts. Shared by the ALL-dups
// count (`isIncluded` always true) and the PRODUCTION-closure-gated count
// (`isIncluded` checks closure membership) so both walk the same reduction.
function computeDuplicateFamilies(
  byName: Map<string, Set<string>>,
  isIncluded: (name: string, version: string) => boolean,
): DuplicateFamily[] {
  const families: DuplicateFamily[] = []
  for (const [name, versions] of byName) {
    // Count registry semver resolutions only. A git or tarball URL resolution
    // is not an npm major and is excluded from cross-major dedup.
    const majors = [
      ...new Set(
        [...versions]
          .filter(isSemverVersion)
          .filter(version => isIncluded(name, version))
          .map(majorOf),
      ),
    ].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (majors.length > 1) {
      families.push({ majors, name })
    }
  }
  families.sort((a, b) => a.name.localeCompare(b.name))
  return families
}

export interface ScanOptions {
  // Text of the cascaded fleet catalog
  // (`.config/fleet/pnpm-workspace.fleet.yaml`) when present — its
  // `@socketregistry/*` entries extend the drop-in universe beyond what the
  // lockfile already resolves.
  fleetCatalogText?: string | undefined
}

export function scan(
  text: string,
  options?: ScanOptions | undefined,
): ScanResult {
  const opts = { __proto__: null, ...options } as ScanOptions
  const lines = text.split('\n')
  const byName = collectResolvedVersions(lines)
  const closure = collectProductionClosure(lines)

  const duplicates = computeDuplicateFamilies(byName, () => true)
  const bundledDuplicates = computeDuplicateFamilies(byName, (name, version) =>
    closure.has(`${name}@${version}`),
  )

  // A universe name still resolving from npm under its bare upstream name
  // means the hardened copy was never wired in for that copy — pnpm rewrites
  // every matching resolution when a redirect override is present, so a
  // surviving bare package key IS the missing redirect (a version-pin
  // override keeps the bare resolution and so still flags; only the
  // npm:@socketregistry/... alias redirect clears it).
  const universe = collectDropInUniverse([text, opts.fleetCatalogText ?? ''])
  const unredirected: UnredirectedDropIn[] = []
  for (const dropIn of universe) {
    const name = upstreamNameOf(dropIn)
    if (byName.has(name)) {
      unredirected.push({ dropIn, name })
    }
  }
  unredirected.sort((a, b) => a.name.localeCompare(b.name))

  return { bundledDuplicates, duplicates, unredirected }
}

function main(): void {
  let content: string
  try {
    content = readFileSync(PNPM_LOCK, 'utf8')
  } catch {
    // No pnpm-lock.yaml — not an installed workspace, nothing to check.
    process.exit(0)
  }
  let fleetCatalogText: string | undefined
  try {
    fleetCatalogText = readFileSync(FLEET_CATALOG_YAML, 'utf8')
  } catch {
    // Catalog absent (repo mid-transition / non-fleet checkout) — the
    // lockfile-learned drop-in universe still applies.
    fleetCatalogText = undefined
  }
  const { bundledDuplicates, duplicates, unredirected } = scan(content, {
    fleetCatalogText,
  })
  // Auto-gated on rolldown, no opt-in: a repo that bundles with rolldown pays
  // real bytes for every duplicate major IN ITS PRODUCTION CLOSURE, so there
  // ANY such cross-major family is a hard failure — the bar is zero dups
  // (force the format-flips, patch-and-force the API-breaks). A dup outside
  // the closure (dev/test/publish-only tooling) never reaches bundle bytes, so
  // it stays informational even in a rolldown repo. A non-bundling repo keeps
  // the whole report informational.
  const enforce = repoUsesRolldown(path.dirname(PNPM_LOCK))
  let failed = false

  const gatedDuplicates = enforce ? bundledDuplicates : duplicates
  if (gatedDuplicates.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${gatedDuplicates.length} package` +
        `${gatedDuplicates.length === 1 ? '' : 's'} resolved at >1 major ` +
        `(${enforce ? 'MUST collapse — this repo bundles with rolldown' : 'collapse candidates'}):\n`,
    )
    for (let i = 0, { length } = gatedDuplicates; i < length; i += 1) {
      const f = gatedDuplicates[i]!
      process.stderr.write(`  ${f.name}: majors ${f.majors.join(', ')}\n`)
    }
    process.stderr.write(
      `\nDrive duplicate majors to zero — force the format-flips, pnpm ` +
        `patch-and-force the API-breaks. See\n` +
        `.claude/skills/fleet/deduping-dependencies/SKILL.md.\n\n`,
    )
    if (enforce) {
      failed = true
    }
  } else if (enforce && duplicates.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] (${duplicates.length} cross-major ` +
        `dup${duplicates.length === 1 ? '' : 's'} are dev/test-only — not ` +
        `bundled, not enforced)\n`,
    )
  }

  if (unredirected.length > 0) {
    process.stderr.write(
      `[check-dependencies-are-deduped] ${unredirected.length} package` +
        `${unredirected.length === 1 ? '' : 's'} with a @socketregistry ` +
        `drop-in but no redirect:\n`,
    )
    for (let i = 0, { length } = unredirected; i < length; i += 1) {
      const f = unredirected[i]!
      process.stderr.write(`  ${f.name} → @socketregistry/${f.dropIn}\n`)
    }
    process.stderr.write(
      `\nAdd the redirect to overrides: in pnpm-workspace.yaml (fleet-canonical\n` +
        `via FLEET_CANONICAL_OVERRIDES). A @socketregistry drop-in is audited +\n` +
        `soak-exempt — the redirect is always safe. See\n` +
        `.claude/skills/fleet/deduping-dependencies/SKILL.md.\n`,
    )
    failed = true
  }

  process.exit(failed ? 1 : 0)
}

// Run only when invoked directly (CLI / CI), not when imported by the unit
// tests for `scan` — `main()` calls `process.exit`, which would tear down the
// test runner mid-suite.
if (isMainModule(import.meta.url)) {
  main()
}
