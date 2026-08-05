/*
 * @file The `pkg:npm` adapter, pnpm tier — the first ecosystem behind the
 *   range-consolidation seam. It reads one question out of an installed pnpm
 *   workspace: which packages resolved to more than one version, and what range
 *   did each consumer of them actually declare?
 *
 *   Both halves come from what the resolver already wrote, never from a guess:
 *
 *   - The RESOLUTIONS come from the shared `pnpm-lock.yaml` graph reader. The
 *     lockfile is pnpm's own record of what it picked, so reading it needs no
 *     subprocess, no network, and no clock, and it is the same reader the dedup
 *     gate uses, so the two can never disagree about what resolved.
 *   - The CONSUMERS are the inverse of that graph plus the importer
 *     declarations. Every resolved package that names the family as a production
 *     child is a consumer, and so is every workspace importer that declares it —
 *     in ANY dependency block, because a `devDependencies` pin excludes a
 *     version exactly as hard as a `dependencies` one.
 *   - The DECLARED RANGES come from `npm-declared-ranges.mts`, which reads a
 *     workspace `specifier:` (following a `catalog:` hop), a published package's
 *     `peerDependencies:` block, and otherwise the dependency's own installed
 *     manifest, since the lockfile records an ordinary transitive range only as
 *     the resolution it produced.
 *
 *   Range semantics for this ecosystem are semver, so the `satisfies` and
 *   `compare` seams are wired to the semver pair explicitly rather than left to
 *   default. A future yarn / bun / vlt tier plugs in at the same seam with its
 *   own reading and the same pair.
 *
 *   Read-only, all of it. Nothing here writes an override, edits a manifest, or
 *   runs an install: the analyzer says which fix is warranted and hands the
 *   judgment to the `deduping-dependencies` decision tree.
 *
 *   A resolved version that is not a registry version — a git or tarball URL, a
 *   `link:` to a workspace package — is dropped from the family. Those are
 *   source-pinned, carry no npm version to intersect, and would otherwise fail
 *   every range and drag a real family into a fake verdict.
 */

import { existsSync } from 'node:fs'

import {
  parsePnpmDepPath,
  readPnpmLockfile,
  resolvePnpmDepPath,
} from '../../_shared/pnpm-lockfile.mts'
import type {
  PnpmImporterDeclaration,
  PnpmLockfileGraph,
} from '../../_shared/pnpm-lockfile.mts'
import {
  resolvePackageJsonPath,
  resolvePnpmLockPath,
  resolvePnpmVirtualStoreDir,
} from '../../paths.mts'
import type {
  ConsumerEvidence,
  EcosystemAdapter,
  EcosystemFamilyRead,
  EcosystemProbe,
  FamilyReading,
} from '../adapter.mts'
import type { OverrideAuditRead } from '../override-audit.mts'
import { compareSemverVersions, satisfiesSemverRange } from '../verdict.mts'
import {
  collectPnpmCatalogSpecifiers,
  collectPnpmOverriddenNames,
  collectPnpmPeerRanges,
  findPnpmInstalledManifest,
  readPnpmManifestDeclaredRange,
  readPnpmVirtualStoreEntries,
  resolveNpmDeclaredRange,
} from './npm-declared-ranges.mts'
import type {
  PnpmCatalogSpecifiers,
  PnpmPeerRanges,
} from './npm-declared-ranges.mts'
import { auditNpmOverrides } from './npm-override-audit.mts'

export const NPM_PURL_TYPE = 'pkg:npm'

/**
 * True for a resolved version that is an npm registry version. pnpm writes a
 * non-registry resolution into the same field — `link:../pkg` for a workspace
 * package, a tarball or git URL for a source pin — and none of those carry a
 * version a range can be tested against.
 */
export function isNpmRegistryVersion(version: string): boolean {
  return /^\d/.test(version)
}

/**
 * True when the repo is a JS package at all. A repo with no `package.json` does
 * not use this ecosystem, which is a not-applicable answer rather than a
 * failure.
 */
export function detectNpmEcosystem(config: EcosystemProbe): boolean {
  return existsSync(resolvePackageJsonPath(config.repoRoot))
}

/**
 * Resolved dep path → every resolved dep path that names it as a production
 * child. The consumer side of the graph, which the lockfile only stores in the
 * parent-to-child direction.
 */
export function invertConsumerEdges(
  consumerEdges: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const consumersByChild = new Map<string, Set<string>>()
  for (const [parent, children] of consumerEdges) {
    for (const child of children) {
      let parents = consumersByChild.get(child)
      if (!parents) {
        parents = new Set<string>()
        consumersByChild.set(child, parents)
      }
      parents.add(parent)
    }
  }
  return consumersByChild
}

/**
 * The evidence row for one workspace declaration of a family, or `undefined`
 * when the declaration resolved to something outside it. The match runs on the
 * RESOLVED dep path rather than the declared name, because an `npm:` alias
 * declares one name and resolves another.
 */
export function readImporterConsumerEvidence(config: {
  readonly catalogs: PnpmCatalogSpecifiers
  readonly declaration: PnpmImporterDeclaration
  readonly familyName: string
}): ConsumerEvidence | undefined {
  const { catalogs, declaration, familyName } = config
  const { version } = declaration
  if (version === undefined) {
    return undefined
  }
  const resolved = parsePnpmDepPath(
    resolvePnpmDepPath(declaration.name, version),
  )
  if (!resolved || resolved.name !== familyName) {
    return undefined
  }
  const range = resolveNpmDeclaredRange({
    catalogs,
    name: declaration.name,
    specifier: declaration.specifier,
  })
  return {
    consumer: `${declaration.importer} (${declaration.kind} ${declaration.name})`,
    consumerKind: 'importer',
    declaredRange: range.range,
    rangeSource: range.source,
    resolvedVersion: resolved.version,
    unreadableReason: range.unreadableReason,
  }
}

/**
 * The evidence row for one published package's dependency on a family. The
 * lockfile's own `peerDependencies:` block is preferred over the installed
 * manifest: it needs no tree on disk, and a peer range is the constraint pnpm
 * itself resolved against.
 */
export function readPackageConsumerEvidence(config: {
  readonly consumerDepPath: string
  readonly familyName: string
  readonly peerRanges: PnpmPeerRanges
  readonly resolvedVersion: string
  readonly storeEntries: readonly string[]
  readonly virtualStoreDir: string
}): ConsumerEvidence {
  const {
    consumerDepPath,
    familyName,
    peerRanges,
    resolvedVersion,
    storeEntries,
    virtualStoreDir,
  } = config
  const peerRange = peerRanges.get(consumerDepPath)?.get(familyName)
  if (peerRange !== undefined) {
    return {
      consumer: consumerDepPath,
      consumerKind: 'package',
      declaredRange: peerRange,
      rangeSource: `pnpm-lock.yaml packages.${consumerDepPath}.peerDependencies.${familyName}`,
      resolvedVersion,
      unreadableReason: undefined,
    }
  }
  const consumer = parsePnpmDepPath(consumerDepPath)
  const manifestPath = consumer
    ? findPnpmInstalledManifest({
        name: consumer.name,
        storeEntries,
        version: consumer.version,
        virtualStoreDir,
      })
    : undefined
  if (manifestPath === undefined) {
    return {
      consumer: consumerDepPath,
      consumerKind: 'package',
      declaredRange: undefined,
      rangeSource: virtualStoreDir,
      resolvedVersion,
      unreadableReason:
        'it is not installed in the virtual store, so its declared range is unreadable',
    }
  }
  const declared = readPnpmManifestDeclaredRange({
    dependencyName: familyName,
    manifestPath,
  })
  return {
    consumer: consumerDepPath,
    consumerKind: 'package',
    declaredRange: declared.range,
    rangeSource: declared.source,
    resolvedVersion,
    unreadableReason: declared.unreadableReason,
  }
}

/**
 * The registry versions of one family, ordered. A name the graph never resolved
 * yields an empty list, which is a measurable state rather than an absent one:
 * an override on a package this tree never installed collapses nothing here.
 */
export function collectNpmRegistryVersions(
  versions: Iterable<string> | undefined,
): readonly string[] {
  return [...(versions ?? [])]
    .filter(isNpmRegistryVersion)
    .toSorted((a, b) => compareSemverVersions(a, b) || a.localeCompare(b))
}

/**
 * Everything a family reading needs that is read once per lockfile rather than
 * once per family: the catalog and override sections, the inverted consumer
 * graph, and the virtual-store listing.
 */
export interface PnpmReadingContext {
  readonly catalogs: PnpmCatalogSpecifiers
  readonly consumersByChild: Map<string, Set<string>>
  readonly importerDeclarations: readonly PnpmImporterDeclaration[]
  readonly overriddenNames: Set<string>
  readonly peerRanges: PnpmPeerRanges
  readonly storeEntries: readonly string[]
  readonly virtualStoreDir: string
}

/**
 * Read every per-lockfile section once, so a pass over many families pays for
 * the catalog walk, the override walk, and the store listing a single time.
 */
export function buildPnpmReadingContext(config: {
  readonly graph: PnpmLockfileGraph
  readonly repoRoot: string
}): PnpmReadingContext {
  const { graph, repoRoot } = config
  const virtualStoreDir = resolvePnpmVirtualStoreDir(repoRoot)
  return {
    catalogs: collectPnpmCatalogSpecifiers(graph.lines),
    consumersByChild: invertConsumerEdges(graph.consumerEdges),
    importerDeclarations: graph.importerDeclarations,
    overriddenNames: collectPnpmOverriddenNames(graph.lines),
    peerRanges: collectPnpmPeerRanges(graph.lines),
    storeEntries: readPnpmVirtualStoreEntries(virtualStoreDir),
    virtualStoreDir,
  }
}

/**
 * One family's reading: every workspace declaration of it, every published
 * package that names it as a production child, and the declared range behind
 * each. Takes the resolved versions rather than looking them up, so a caller
 * can read a family that resolved once, twice, or not at all.
 */
export function readPnpmFamilyReading(config: {
  readonly context: PnpmReadingContext
  readonly name: string
  readonly resolvedVersions: readonly string[]
}): FamilyReading {
  const { context, name, resolvedVersions } = config
  const {
    catalogs,
    consumersByChild,
    importerDeclarations,
    overriddenNames,
    peerRanges,
    storeEntries,
    virtualStoreDir,
  } = context
  const consumers: ConsumerEvidence[] = []
  for (
    let d = 0, { length: declarationCount } = importerDeclarations;
    d < declarationCount;
    d += 1
  ) {
    const row = readImporterConsumerEvidence({
      catalogs,
      declaration: importerDeclarations[d]!,
      familyName: name,
    })
    if (row) {
      consumers.push(row)
    }
  }
  for (
    let v = 0, { length: versionCount } = resolvedVersions;
    v < versionCount;
    v += 1
  ) {
    const resolvedVersion = resolvedVersions[v]!
    const parents = consumersByChild.get(`${name}@${resolvedVersion}`)
    for (const consumerDepPath of parents ?? []) {
      consumers.push(
        readPackageConsumerEvidence({
          consumerDepPath,
          familyName: name,
          peerRanges,
          resolvedVersion,
          storeEntries,
          virtualStoreDir,
        }),
      )
    }
  }
  return {
    evidence: { consumers, name, resolvedVersions },
    input: {
      compare: compareSemverVersions,
      consumers: consumers.map(row => ({
        consumer: row.consumer,
        range: row.declaredRange,
      })),
      hasOverride: overriddenNames.has(name),
      name,
      resolvedVersions,
      satisfies: satisfiesSemverRange,
    },
  }
}

/**
 * Every duplicated family in a pnpm graph, with the evidence behind each
 * consumer's declared range. A family with fewer than two registry resolutions
 * is not a duplicate, so it is skipped here and audited by the override pass
 * instead, which is where a single-version family still matters.
 */
export function readPnpmFamilyReadings(config: {
  readonly graph: PnpmLockfileGraph
  readonly repoRoot: string
}): readonly FamilyReading[] {
  const { graph, repoRoot } = config
  const context = buildPnpmReadingContext({ graph, repoRoot })
  const readings: FamilyReading[] = []
  for (const [name, versionSet] of graph.versionsByName) {
    const resolvedVersions = collectNpmRegistryVersions(versionSet)
    if (resolvedVersions.length < 2) {
      continue
    }
    readings.push(readPnpmFamilyReading({ context, name, resolvedVersions }))
  }
  return readings
}

/**
 * Read the repo's duplicated npm families, or say loudly why it could not. An
 * absent lockfile is reported as a failure rather than an empty family list: a
 * repo with no install has no measured resolution, and calling that "no
 * duplicates" is the false-green this whole analyzer exists to avoid.
 */
export function readNpmFamilies(config: EcosystemProbe): EcosystemFamilyRead {
  const { repoRoot } = config
  const lockfilePath = resolvePnpmLockPath(repoRoot)
  const read = readPnpmLockfile(lockfilePath)
  if (!read.ok) {
    return {
      ok: false,
      reason:
        `cannot read the pnpm lockfile, so no range-consolidation verdict.\n` +
        `  Where: ${lockfilePath}\n` +
        `  Saw vs wanted: ${read.problem} (${read.reason}); wanted a readable ` +
        `pnpm-lock.yaml\n` +
        `  Fix: run \`pnpm install\` from the repo root, then re-run this ` +
        `analysis.`,
    }
  }
  return {
    ok: true,
    readings: readPnpmFamilyReadings({ graph: read.graph, repoRoot }),
  }
}

export const npmEcosystemAdapter: EcosystemAdapter = {
  auditOverrides(config: EcosystemProbe): Promise<OverrideAuditRead> {
    return Promise.resolve(auditNpmOverrides(config))
  },
  detect(config: EcosystemProbe): Promise<boolean> {
    return Promise.resolve(detectNpmEcosystem(config))
  },
  purlType: NPM_PURL_TYPE,
  readFamilies(config: EcosystemProbe): Promise<EcosystemFamilyRead> {
    return Promise.resolve(readNpmFamilies(config))
  },
}
