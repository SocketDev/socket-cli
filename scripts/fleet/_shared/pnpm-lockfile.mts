/*
 * @file The fleet's one `pnpm-lock.yaml` reader. It turns the lockfile into a
 *   resolved-package graph: every resolved version grouped by package name, the
 *   production edges between resolved packages, the importer roots those edges
 *   start from, the closure that walk reaches, and every dependency the
 *   importers DECLARE with the specifier each one wrote. What the graph MEANS
 *   stays with each caller — the dedup gate reads cross-major families out of
 *   it, the range-consolidation analyzer reads duplicate families and their
 *   consumers.
 *
 *   Lockfile versions v5 and v6 keep every resolution under `packages:` with
 *   peer suffixes on the key; v9 splits them across a bare-keyed `packages:`
 *   plus a peer-suffixed `snapshots:`. Both sections feed one name-to-versions
 *   grouping and peer suffixes are stripped from every key, so all three shapes
 *   read alike. The declared `lockfileVersion` rides along on the graph for a
 *   caller that needs to branch on it.
 *
 *   A line scan rather than a YAML load: every shape read here sits at pnpm's
 *   own fixed two-, four-, six-, and eight-space indents.
 *
 *   An absent, unreadable, or unrecognizable lockfile is REPORTED. Flattening
 *   one into an empty graph would read as "nothing resolved", the false-green
 *   this module exists to make impossible.
 */

import { existsSync, readFileSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

// A dep path — `<name>@<version>` where the name may be scoped (`@scope/pkg`)
// and the version may carry repeated peer suffixes (`(peer@1.0.0)`). Group 1 is
// the name, group 2 the version. One source string feeds both dep-path regexes
// below so the bare form and the section-key form can never disagree about what
// a dep path is.
const DEP_PATH_SOURCE = String.raw`((?:@[^@/'\s]+\/)?[^@'\s]+)@([^'\s(]+)(?:\([^)]*\))*`

// A whole dep path and nothing else: `foo@1.0.0`, `@scope/foo@1.0.0`,
// `foo@1.0.0(peer@2.0.0)`.
const DEP_PATH_RE = new RegExp(`^${DEP_PATH_SOURCE}$`)

// A `packages:` or `snapshots:` entry key — a dep path indented exactly two
// spaces, optionally single-quoted, closed by a colon: `  'foo@1.0.0':`.
const DEP_PATH_KEY_LINE_RE = new RegExp(`^ {2}'?${DEP_PATH_SOURCE}'?:\\s*$`)

// The `lockfileVersion: '9.0'` header, quoted or bare.
const LOCKFILE_VERSION_RE = /^lockfileVersion:\s*'?([^'\s]+?)'?\s*$/

// A 4-space dependency-kind header inside an importer or a snapshot entry
// (`dependencies:`, `devDependencies:`, `optionalDependencies:`, …) — shared by
// both, since pnpm nests both shapes at the same two levels.
const DEPENDENCY_KIND_RE = /^ {4}(?!\s)([A-Za-z]+):\s*$/
// A 6-space `<name>:` importer dependency entry with no inline value — its
// declared specifier and resolved version live on the nested lines below it.
const IMPORTER_DEP_NAME_RE = /^ {6}(?!\s)'?([^'\n]+?)'?:\s*$/
// The 8-space `specifier:` / `version:` lines under an importer dependency
// entry — the DECLARED range and the RESOLVED version of one declaration.
const IMPORTER_DEP_FIELD_RE = /^ {8}(?!\s)(specifier|version):\s*(.+)$/
// A 2-space `<path>:` importer key with no inline value — the boundary between
// one importer's dependency blocks and the next.
const IMPORTER_KEY_RE = /^ {2}\S.*:\s*$/
// A 6-space `<name>: <value>` entry with an inline value — a snapshot's
// resolved child, or a `packages:` entry's declared peer range.
const NESTED_ENTRY_RE = /^ {6}(?!\s)'?([^'\n]+?)'?:\s*(.+)$/

export interface PnpmDepPath {
  name: string
  version: string
}

// One dependency an importer DECLARES: which importer, which dependency-kind
// block, the declared specifier, and the version it resolved to. The specifier
// is pnpm's raw text (`^1.0.0`, `catalog:`, `workspace:*`, `npm:other@1`), so
// reducing it to an ecosystem range stays with the caller.
export interface PnpmImporterDeclaration {
  importer: string
  kind: string
  name: string
  specifier: string | undefined
  version: string | undefined
}

export interface PnpmNestedEntry {
  name: string
  value: string
}

export interface PnpmLockfileGraph {
  // Resolved dep path → the resolved dep paths of its production children.
  consumerEdges: Map<string, Set<string>>
  // Every dependency every importer declares, all kinds, with its specifier.
  importerDeclarations: readonly PnpmImporterDeclaration[]
  // The resolved dep paths every importer's production blocks name directly.
  importerProductionRoots: Set<string>
  lines: readonly string[]
  lockfileVersion: string | undefined
  // Every resolved dep path reachable from an importer production root.
  productionClosure: Set<string>
  text: string
  // Package name → every distinct resolved version of it, peer suffixes
  // stripped.
  versionsByName: Map<string, Set<string>>
}

// Why a lockfile yielded no graph. `absent` is a normal state for a repo with
// no install; the other two are failures a caller must surface.
export type PnpmLockfileProblem = 'absent' | 'unreadable' | 'unrecognized'

export interface PnpmLockfileReadFailure {
  ok: false
  problem: PnpmLockfileProblem
  reason: string
}

export interface PnpmLockfileReadSuccess {
  graph: PnpmLockfileGraph
  ok: true
}

export type PnpmLockfileReadResult =
  | PnpmLockfileReadFailure
  | PnpmLockfileReadSuccess

// The dependency kinds an installed runtime tree actually carries.
// `devDependencies`, `peerDependencies`, `configDependencies`, and
// `packageManagerDependencies` are excluded — nothing rooted only from one of
// those ships to a consumer.
export function isProductionDependencyKind(kind: string): boolean {
  return kind === 'dependencies' || kind === 'optionalDependencies'
}

/**
 * Split a bare dep path into its package name and resolved version, dropping
 * any peer suffix. Returns `undefined` for a string that is not a dep path.
 */
export function parsePnpmDepPath(depPath: string): PnpmDepPath | undefined {
  const m = DEP_PATH_RE.exec(depPath)
  return m ? { name: m[1]!, version: m[2]! } : undefined
}

/**
 * Split a `packages:` / `snapshots:` entry line into its package name and
 * resolved version. Returns `undefined` for any other line, which is how the
 * section walks skip `resolution:` bodies and blank lines.
 */
export function parsePnpmDepPathKeyLine(line: string): PnpmDepPath | undefined {
  const m = DEP_PATH_KEY_LINE_RE.exec(line)
  return m ? { name: m[1]!, version: m[2]! } : undefined
}

/**
 * Split a 6-space `<name>: <value>` entry line into its name and raw value —
 * the shape a snapshot's resolved child and a `packages:` entry's declared peer
 * range share. Returns `undefined` for any other line.
 */
export function parsePnpmNestedEntry(
  line: string,
): PnpmNestedEntry | undefined {
  const m = NESTED_ENTRY_RE.exec(line)
  return m ? { name: m[1]!, value: m[2]! } : undefined
}

/**
 * The declared `lockfileVersion`, or `undefined` when the header is absent.
 */
export function readPnpmLockfileVersion(
  lines: readonly string[],
): string | undefined {
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = LOCKFILE_VERSION_RE.exec(lines[i] ?? '')
    if (m) {
      return m[1]!
    }
  }
  return undefined
}

/**
 * Strip a YAML scalar's surrounding single quotes, if present.
 */
export function stripYamlQuotes(value: string): string {
  if (
    value.length >= 2 &&
    value[0] === "'" &&
    value[value.length - 1] === "'"
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Strip a peer-suffix parenthetical (`(peer@1.0.0)`, possibly repeated) from a
 * resolved version-field VALUE — the value-side counterpart of what the
 * dep-path regexes already strip from a resolved KEY.
 */
export function stripPnpmPeerSuffix(value: string): string {
  const index = value.indexOf('(')
  return index === -1 ? value : value.slice(0, index)
}

/**
 * Reduce an importer/snapshot dependency's `<name>` plus its raw version-field
 * VALUE to the resolved dep path `<name>@<version>`. A pnpm `npm:` alias
 * rewrites the VALUE to the redirect target's own `<realName>@<version>`, e.g.
 * `gopd:` resolving to `@socketregistry/gopd@1.0.7`, instead of a bare version
 * — detected by an `@` surviving the peer-suffix strip, since a bare semver or
 * URL version never contains one.
 */
export function resolvePnpmDepPath(name: string, rawValue: string): string {
  const base = stripPnpmPeerSuffix(stripYamlQuotes(rawValue.trim()))
  return base.includes('@') ? base : `${name}@${base}`
}

/**
 * Group every `<name>@<version>` key under the resolved sections (`packages:`
 * and `snapshots:`) into name → the set of its distinct resolved versions.
 */
export function collectResolvedVersions(
  lines: readonly string[],
): Map<string, Set<string>> {
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
    const depPath = parsePnpmDepPathKeyLine(line)
    if (!depPath) {
      continue
    }
    let versions = byName.get(depPath.name)
    if (!versions) {
      versions = new Set<string>()
      byName.set(depPath.name, versions)
    }
    versions.add(depPath.version)
  }
  return byName
}

/**
 * Collect every dependency every importer DECLARES — all kinds, each with the
 * specifier the manifest wrote and the version pnpm resolved it to. The
 * dependency-kind block is reported rather than filtered because a declared
 * range constrains a resolution whichever block it sits in: a `devDependencies`
 * pin excludes a version just as hard as a `dependencies` one.
 */
export function collectImporterDeclarations(
  lines: readonly string[],
): readonly PnpmImporterDeclaration[] {
  const declarations: PnpmImporterDeclaration[] = []
  let inImporters = false
  let importer: string | undefined
  let kind: string | undefined
  let pending: PnpmImporterDeclaration | undefined
  const flush = () => {
    if (pending) {
      declarations.push(pending)
      pending = undefined
    }
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'importers:') {
      flush()
      inImporters = true
      importer = undefined
      kind = undefined
      continue
    }
    // A new unindented top-level key ends the section.
    if (inImporters && /^[A-Za-z_]/.test(line)) {
      flush()
      inImporters = false
      continue
    }
    if (!inImporters) {
      continue
    }
    if (IMPORTER_KEY_RE.test(line)) {
      flush()
      importer = stripYamlQuotes(line.trim().replace(/:$/, ''))
      kind = undefined
      continue
    }
    const kindMatch = DEPENDENCY_KIND_RE.exec(line)
    if (kindMatch) {
      flush()
      kind = kindMatch[1]!
      continue
    }
    if (importer === undefined || kind === undefined) {
      continue
    }
    const fieldMatch = IMPORTER_DEP_FIELD_RE.exec(line)
    if (fieldMatch && pending) {
      const value = stripYamlQuotes(fieldMatch[2]!.trim())
      if (fieldMatch[1] === 'specifier') {
        pending.specifier = value
      } else {
        pending.version = value
      }
      continue
    }
    const nameMatch = IMPORTER_DEP_NAME_RE.exec(line)
    if (nameMatch) {
      flush()
      pending = {
        importer,
        kind,
        name: nameMatch[1]!,
        specifier: undefined,
        version: undefined,
      }
    }
  }
  flush()
  return declarations
}

/**
 * Reduce importer declarations to the PRODUCTION roots — `dependencies:` and
 * `optionalDependencies:` entries only. These are the entry points an installed
 * runtime tree, and so a bundle, can actually reach; anything rooted only from
 * a dev/peer/config block never ships.
 */
export function collectProductionRootsFromDeclarations(
  declarations: readonly PnpmImporterDeclaration[],
): Set<string> {
  const roots = new Set<string>()
  for (let i = 0, { length } = declarations; i < length; i += 1) {
    const declaration = declarations[i]!
    const { version } = declaration
    if (version !== undefined && isProductionDependencyKind(declaration.kind)) {
      roots.add(resolvePnpmDepPath(declaration.name, version))
    }
  }
  return roots
}

/**
 * Every importer's PRODUCTION dependency root, read straight from lockfile
 * text.
 */
export function collectImporterProductionRoots(
  lines: readonly string[],
): Set<string> {
  return collectProductionRootsFromDeclarations(
    collectImporterDeclarations(lines),
  )
}

/**
 * Build the consumer graph: resolved dep path → the resolved dep paths of its
 * `dependencies:` + `optionalDependencies:` children. `devDependencies:` /
 * `peerDependencies:` edges are excluded — an installed runtime tree only walks
 * the production edges pnpm actually materializes.
 */
export function collectSnapshotEdges(
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
    const depPath = parsePnpmDepPathKeyLine(line)
    if (depPath) {
      currentKey = `${depPath.name}@${depPath.version}`
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
      inProdSection = isProductionDependencyKind(kindMatch[1]!)
      continue
    }
    if (!inProdSection) {
      continue
    }
    const child = parsePnpmNestedEntry(line)
    if (child) {
      graph.get(currentKey)!.add(resolvePnpmDepPath(child.name, child.value))
    }
  }
  return graph
}

/**
 * Walk `edges` from `roots` and return every resolved dep path reached. Kept
 * separate from the collectors so a caller that already holds a graph can walk
 * it from a different root set.
 */
export function walkDependencyClosure(
  roots: Iterable<string>,
  edges: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const key = queue.pop()!
    if (visited.has(key)) {
      continue
    }
    visited.add(key)
    const children = edges.get(key)
    if (children) {
      for (const child of children) {
        queue.push(child)
      }
    }
  }
  return visited
}

/**
 * The set of every `<name>@<version>` reachable from a PRODUCTION importer root
 * through the snapshot graph — what an installed runtime tree, and so a bundle,
 * can actually pull in. Dev/test/publish-only tooling that no importer's
 * `dependencies:`/`optionalDependencies:` ever roots is excluded, even when it
 * resolves at multiple majors.
 */
export function collectProductionClosure(
  lines: readonly string[],
): Set<string> {
  return walkDependencyClosure(
    collectImporterProductionRoots(lines),
    collectSnapshotEdges(lines),
  )
}

/**
 * Read a lockfile's text into the graph. Total: any text parses, and a text
 * that holds none of the shapes yields an empty graph, which
 * `readPnpmLockfile` is the layer that refuses to hand back as a result.
 */
export function parsePnpmLockfileText(text: string): PnpmLockfileGraph {
  const lines = text.split('\n')
  const consumerEdges = collectSnapshotEdges(lines)
  const importerDeclarations = collectImporterDeclarations(lines)
  const importerProductionRoots =
    collectProductionRootsFromDeclarations(importerDeclarations)
  return {
    consumerEdges,
    importerDeclarations,
    importerProductionRoots,
    lines,
    lockfileVersion: readPnpmLockfileVersion(lines),
    productionClosure: walkDependencyClosure(
      importerProductionRoots,
      consumerEdges,
    ),
    text,
    versionsByName: collectResolvedVersions(lines),
  }
}

/**
 * Read `pnpm-lock.yaml` from disk into the graph. The three failure shapes are
 * distinct on purpose: `absent` is the normal no-install state a caller may
 * skip on, while `unreadable` (a permission or I/O error) and `unrecognized`
 * (a text carrying neither a `lockfileVersion` header nor one resolved package)
 * are blindness a caller must report rather than read as an empty tree.
 */
export function readPnpmLockfile(lockfilePath: string): PnpmLockfileReadResult {
  if (!existsSync(lockfilePath)) {
    return {
      ok: false,
      problem: 'absent',
      reason: `no lockfile at ${lockfilePath}`,
    }
  }
  let text: string
  try {
    text = readFileSync(lockfilePath, 'utf8')
  } catch (e) {
    return { ok: false, problem: 'unreadable', reason: errorMessage(e) }
  }
  const graph = parsePnpmLockfileText(text)
  if (graph.lockfileVersion === undefined && graph.versionsByName.size === 0) {
    return {
      ok: false,
      problem: 'unrecognized',
      reason: 'no lockfileVersion header and no resolved package entries',
    }
  }
  return { graph, ok: true }
}
