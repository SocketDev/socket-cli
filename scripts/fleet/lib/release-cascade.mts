/*
 * @file The RELEASE CASCADE GRAPH — code-as-law for what a fleet package's
 *   release OWES downstream. Cutting a release is never the end of the train:
 *   consumers pin the package in their pnpm catalogs, socket-registry's
 *   registry/manifest.json declares its purl at an exact version, and some of
 *   those declarations must themselves ship in a follow-up release. Before
 *   this graph the obligations lived in operator memory, and the 1.4.2
 *   incident is what forgetting looks like: @socketregistry/packageurl-js
 *   moved on while socket-registry's manifest.json still declared
 *   `pkg:npm/%40socketregistry/packageurl-js@1.4.2` — a stale manifest entry
 *   shipping wrong metadata until a human noticed.
 *
 *   Three obligation kinds:
 *   - `catalog-pin` — a downstream repo's pnpm-workspace.yaml `catalog:` block
 *     pins the package at an exact version; `fleet` is the sentinel for the
 *     wheelhouse fleet catalog, .config/fleet/pnpm-workspace.fleet.yaml, which
 *     cascades to every member.
 *   - `registry-manifest-entry` — socket-registry's registry/manifest.json
 *     carries a purl entry whose version must track the registry latest.
 *   - `follow-up-release` — absorbing the new version is not enough; the
 *     downstream repo must also CUT A RELEASE so the absorbed version ships.
 *
 *   Consumers:
 *   - check/cascade-followups-are-settled.mts computes OWED follow-ups —
 *     registry latest vs downstream declarations — and goes red on lag;
 *   - release-pipeline.mts prints the owed list right after the approve and
 *     reconcile release stages cut a tag, so the operator leaves the release
 *     with the follow-up train named.
 *
 *   Pure by design: node-builtin-free data + functions, so the tag-gap
 *   healer's summary path and vitest fixtures can both load it anywhere.
 */

/**
 * Sentinel repo name for the wheelhouse fleet catalog — the cascaded
 * `catalog:` slice every member carries. A `catalog-pin` obligation on this
 * target means the pin in .config/fleet/pnpm-workspace.fleet.yaml, whose
 * source of truth is the wheelhouse's template/base copy.
 */
export const FLEET_CATALOG = 'fleet'

export type CascadeObligationKind =
  | 'catalog-pin'
  | 'follow-up-release'
  | 'registry-manifest-entry'

/**
 * One downstream obligation a package's release creates, flattened to a
 * single target repo. `repo` is the sibling clone's directory name, or the
 * FLEET_CATALOG sentinel on a catalog-pin edge.
 */
export interface CascadeEdge {
  kind: CascadeObligationKind
  repo: string
}

/**
 * The declarative form: catalog-pin names its repo list in one entry — the
 * shape the graph is read and reviewed in — while the other kinds target one
 * repo each. `flattenObligations` turns a package's declarations into
 * per-repo CascadeEdge items for evaluation.
 */
export type CascadeObligationDecl =
  | { kind: 'catalog-pin'; repos: readonly string[] }
  | { kind: 'follow-up-release'; repo: string }
  | { kind: 'registry-manifest-entry'; repo: string }

/**
 * The graph. Key = published package name; value = the downstream obligations
 * its release creates. Adding a published fleet package or a new consumer is
 * an edit HERE — the check and the post-release prints follow automatically.
 */
export const RELEASE_CASCADE_GRAPH: Readonly<
  Record<string, readonly CascadeObligationDecl[]>
> = {
  // packageurl-js is the deepest edge: consumers pin it, socket-registry
  // declares its purl in registry/manifest.json, and that manifest change
  // only ships when socket-registry itself cuts a follow-up release — the
  // 1.4.2-manifest incident chain, end to end.
  '@socketregistry/packageurl-js': [
    {
      kind: 'catalog-pin',
      repos: ['socket-sdk-js', 'socket-cli', FLEET_CATALOG],
    },
    { kind: 'registry-manifest-entry', repo: 'socket-registry' },
    { kind: 'follow-up-release', repo: 'socket-registry' },
    // socket-sdk-js has zero runtime dependencies and BUNDLES packageurl-js
    // into its published dist at build time, so a packageurl-js bump changes
    // sdk's shipped bytes and reaches consumers only when sdk cuts its own
    // release — the catalog pin alone never ships it. See the bundling helpers
    // below for the machine-checked form of this obligation.
    { kind: 'follow-up-release', repo: 'socket-sdk-js' },
  ],
  '@socketsecurity/lib': [
    {
      kind: 'catalog-pin',
      repos: ['socket-packageurl-js', 'socket-sdk-js', FLEET_CATALOG],
    },
    // socket-packageurl-js and socket-sdk-js both have zero runtime
    // dependencies and BUNDLE socket-lib into their published dist — it is a
    // devDependency compiled in at build time, not resolved at install. An
    // upstream socket-lib bump therefore changes each downstream's shipped
    // bytes, so it ships only when that downstream cuts a follow-up release,
    // NOT on the catalog pin alone. A socket-lib bump owes real downstream
    // releases, not just catalog pins — the bundling helpers below prove it.
    { kind: 'follow-up-release', repo: 'socket-packageurl-js' },
    { kind: 'follow-up-release', repo: 'socket-sdk-js' },
  ],
  '@socketsecurity/sdk': [{ kind: 'catalog-pin', repos: [FLEET_CATALOG] }],
}

/**
 * A package's obligations flattened to per-repo edges, in declaration order.
 * Unknown packages flatten to an empty list — a leaf package with no
 * downstream obligations is a valid, quiet state.
 */
export function flattenObligations(pkgName: string): CascadeEdge[] {
  const decls = RELEASE_CASCADE_GRAPH[pkgName] ?? []
  const edges: CascadeEdge[] = []
  for (const decl of decls) {
    if (decl.kind === 'catalog-pin') {
      for (const repo of decl.repos) {
        edges.push({ kind: 'catalog-pin', repo })
      }
    } else {
      edges.push({ kind: decl.kind, repo: decl.repo })
    }
  }
  return edges
}

/*
 * Bundling awareness — WHY the follow-up-release edges above exist, and how the
 * graph PROVES it declared one for every bundled pair.
 *
 * socket-packageurl-js and socket-sdk-js ship ZERO runtime `dependencies`:
 * they compile their devDependencies straight into `dist/**` at build time.
 * socket-lib is inlined into packageurl-js's and sdk's published dist; sdk
 * additionally inlines packageurl-js. So an upstream bump does not reach a
 * downstream's consumers by a catalog pin alone — it changes the downstream's
 * shipped BYTES, and those bytes go out only when the downstream cuts its OWN
 * release. That is precisely a `follow-up-release` obligation. The helpers
 * below let the settle-check assert the graph declared one for every bundled
 * pair, so a future bundled dep can't be silently under-declared and left to
 * operator memory — the failure mode that reasoned "a socket-lib bump owes
 * only catalog pins" and missed the downstream releases entirely.
 */

/**
 * The package.json fields this module reads to decide bundling. A loose,
 * forward-compatible subset — every field optional, unknown extras ignored.
 */
export interface RepoManifest {
  readonly dependencies?: Readonly<Record<string, string>> | undefined
  readonly devDependencies?: Readonly<Record<string, string>> | undefined
  readonly exports?: unknown | undefined
  readonly files?: readonly string[] | undefined
  readonly main?: string | undefined
  readonly module?: string | undefined
  readonly types?: string | undefined
}

// True when `value` names a path into a `dist/` build directory: a bare
// `dist/...` or a `./dist/...` / nested `/dist/...` reference, but never a
// same-name FILE like `dist.js` (the char after `dist` must be `/` or the end).
function referencesDist(value: unknown): boolean {
  return typeof value === 'string' && /(?:^|[./])dist(?:\/|$)/.test(value)
}

// Recursively true when any leaf string in an `exports` tree references dist/.
// `exports` is an arbitrarily nested subpath -> conditions -> target map.
function hasDistTarget(node: unknown): boolean {
  if (typeof node === 'string') {
    return referencesDist(node)
  }
  if (Array.isArray(node)) {
    return node.some(hasDistTarget)
  }
  if (node && typeof node === 'object') {
    return Object.values(node).some(hasDistTarget)
  }
  return false
}

/**
 * True when the repo ships a BUNDLED build directory — its entry points
 * (`main`/`module`/`types`), its published `files`, or its `exports` targets
 * resolve into `dist/`. The signal that its devDependencies are compiled into
 * the shipped artifact rather than resolved at install time.
 */
export function shipsBundledDist(pkgJson: RepoManifest): boolean {
  if (
    referencesDist(pkgJson.main) ||
    referencesDist(pkgJson.module) ||
    referencesDist(pkgJson.types)
  ) {
    return true
  }
  if (Array.isArray(pkgJson.files) && pkgJson.files.some(referencesDist)) {
    return true
  }
  return pkgJson.exports !== undefined && hasDistTarget(pkgJson.exports)
}

/**
 * True when `repoPkgJson` BUNDLES `depName` into its published artifact: the
 * repo has zero runtime `dependencies` (or `depName` is absent from them), the
 * dep is a `devDependency`, compiled in at build time, not installed, AND the
 * repo ships a bundled `dist/`. When all three hold an upstream `depName` bump
 * changes this repo's shipped bytes, so it OWES a follow-up release — a catalog
 * pin absorbs the version but never ships it.
 */
export function bundlesDependency(
  repoPkgJson: RepoManifest,
  depName: string,
): boolean {
  const deps = repoPkgJson.dependencies ?? {}
  const zeroRuntimeDeps = Object.keys(deps).length === 0
  const depAbsentFromRuntime = !(depName in deps)
  const inDevDependencies = depName in (repoPkgJson.devDependencies ?? {})
  return (
    (zeroRuntimeDeps || depAbsentFromRuntime) &&
    inDevDependencies &&
    shipsBundledDist(repoPkgJson)
  )
}

/**
 * Every downstream repo the graph declares an obligation for, excluding the
 * FLEET_CATALOG sentinel — the set of sibling clones the bundling assert reads.
 */
export function downstreamRepos(): string[] {
  const repos = new Set<string>()
  const declSets = Object.values(RELEASE_CASCADE_GRAPH)
  for (let i = 0, { length } = declSets; i < length; i += 1) {
    const decls = declSets[i]!
    for (const decl of decls) {
      if (decl.kind === 'catalog-pin') {
        for (const repo of decl.repos) {
          if (repo !== FLEET_CATALOG) {
            repos.add(repo)
          }
        }
      } else if (decl.repo !== FLEET_CATALOG) {
        repos.add(decl.repo)
      }
    }
  }
  return [...repos]
}

/**
 * One bundled upstream->downstream pair the graph FAILS to declare a
 * follow-up-release edge for — a bundled dep whose bump would ship stale.
 */
export interface UndeclaredBundledEdge {
  pkg: string
  repo: string
}

/**
 * Assert every bundled upstream->downstream pair carries a matching
 * follow-up-release edge. For each graph upstream package and each downstream
 * repo whose manifest BUNDLES it, the graph must declare a `follow-up-release`
 * edge for that repo; a bundled pair with no such edge is returned so the
 * caller can go red. Pure over already-read manifests, so a missing sibling
 * clone is simply absent from `reposByDir` and never a false positive. An empty
 * result means every bundled pair is declared.
 */
export function findUndeclaredBundledEdges(
  reposByDir: Readonly<Record<string, RepoManifest>>,
): UndeclaredBundledEdge[] {
  const missing: UndeclaredBundledEdge[] = []
  const pkgs = Object.keys(RELEASE_CASCADE_GRAPH)
  for (let i = 0, { length } = pkgs; i < length; i += 1) {
    const pkg = pkgs[i]!
    const followUpRepos = new Set(
      flattenObligations(pkg)
        .filter(edge => edge.kind === 'follow-up-release')
        .map(edge => edge.repo),
    )
    for (const [repo, pkgJson] of Object.entries(reposByDir)) {
      if (bundlesDependency(pkgJson, pkg) && !followUpRepos.has(repo)) {
        missing.push({ pkg, repo })
      }
    }
  }
  return missing
}

/**
 * Loose semver-ascending comparator, dependency-free: numeric dotted main
 * parts, then a release sorts AFTER its own prereleases, then prerelease
 * strings lexicographically. The twin of reconcile-gap.mts's comparator —
 * duplicated two functions deep rather than imported so this module stays
 * loadable with zero module-level side effects; reconcile-gap resolves its
 * repo root at import time.
 */
export function compareVersionsLoose(a: string, b: string): number {
  const [mainA = '', preA] = a.split('-', 2) as [string, string | undefined]
  const [mainB = '', preB] = b.split('-', 2) as [string, string | undefined]
  const partsA = mainA.split('.').map(n => Number.parseInt(n, 10) || 0)
  const partsB = mainB.split('.').map(n => Number.parseInt(n, 10) || 0)
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i += 1) {
    const d = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (d !== 0) {
      return d
    }
  }
  if (preA === undefined && preB === undefined) {
    return 0
  }
  if (preA === undefined) {
    return 1
  }
  if (preB === undefined) {
    return -1
  }
  return preA < preB ? -1 : preA > preB ? 1 : 0
}

/**
 * The version socket-registry's registry/manifest.json declares for `pkgName`,
 * or undefined when the text doesn't parse or carries no entry. The manifest
 * shape: `{ npm: [ [purl, { name, version, … }], … ] }` — the metadata object
 * is the read surface, the purl's `@<version>` suffix is cross-checkable but
 * the object's `version` field is authoritative here.
 */
export function manifestEntryVersion(
  manifestText: string,
  pkgName: string,
): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    return undefined
  }
  const npm = (parsed as { npm?: unknown | undefined } | null)?.npm
  if (!Array.isArray(npm)) {
    return undefined
  }
  for (const entry of npm) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue
    }
    const meta = entry[1] as
      | { name?: unknown | undefined; version?: unknown | undefined }
      | null
      | undefined
    if (
      meta &&
      typeof meta === 'object' &&
      meta.name === pkgName &&
      typeof meta.version === 'string'
    ) {
      return meta.version
    }
  }
  return undefined
}

/**
 * One observation of a downstream obligation: what the target repo DECLARES
 * for the package right now. `readable: false` is the honest-skip channel —
 * no local clone, unreadable file — and never converts into an owed verdict.
 * `follow-up-release` edges carry no reading of their own; they derive from
 * their same-repo siblings in `computeOwedFollowUps`.
 */
export interface ObligationReading {
  /**
   * The version the downstream declares, or undefined when readable but
   * absent — a missing declaration the graph says must exist.
   */
  declared: string | undefined
  edge: CascadeEdge
  pkg: string
  readable: boolean
  /**
   * Where the observation came from — a file path, or the skip reason when
   * `readable` is false.
   */
  source: string
}

/**
 * One OWED follow-up: the downstream declaration lags the registry latest,
 * with the remedial action named.
 */
export interface OwedFollowUp {
  action: string
  declared: string | undefined
  edge: CascadeEdge
  latest: string
  pkg: string
}

/**
 * One honest skip: the obligation could not be evaluated this run — no local
 * clone, unreachable registry — so it is neither settled nor owed.
 */
export interface SkippedObligation {
  detail: string
  edge: CascadeEdge
  pkg: string
}

/**
 * The remedial action for an owed edge, named concretely enough to execute.
 */
function owedAction(config: {
  declared: string | undefined
  edge: CascadeEdge
  latest: string
  pkg: string
}): string {
  const { declared, edge, latest, pkg } = config
  const saw = declared === undefined ? 'no entry' : declared
  if (edge.kind === 'catalog-pin') {
    return edge.repo === FLEET_CATALOG
      ? `bump the '${pkg}' fleet catalog pin to ${latest} — saw ${saw} — in the wheelhouse's template/base/.config/fleet/pnpm-workspace.fleet.yaml, then cascade`
      : `bump the '${pkg}' catalog pin in ${edge.repo}/pnpm-workspace.yaml to ${latest} — saw ${saw}`
  }
  if (edge.kind === 'registry-manifest-entry') {
    return `bump the ${pkg} purl entry in ${edge.repo}/registry/manifest.json to ${latest} — saw ${saw}`
  }
  return `cut a ${edge.repo} release once ${pkg}@${latest} is absorbed — its declarations lag, so the shipped artifact is stale`
}

/**
 * Compute the OWED follow-ups from registry truth vs downstream observations.
 * Pure — the check gathers readings and registry latests, this decides.
 *
 * Verdicts per edge:
 * - settled — the declaration equals or is AHEAD of latest; ahead means the
 * downstream already absorbed a pending version, never a lag;
 * - owed — the declaration lags latest, or is readable-but-absent;
 * - skipped — the registry latest is unknown for the package, or the reading
 * is `readable: false`; honesty over guessing.
 *
 * `follow-up-release` derives from its same-repo siblings: owed when any
 * sibling obligation on that repo is owed — the repo must absorb AND ship —
 * skipped when every sibling was skipped, settled otherwise. Once the repo's
 * declarations are current this module cannot cheaply prove the follow-up
 * release itself was cut; that residual is the tag-gap healer's beat.
 */
export function computeOwedFollowUps(config: {
  latestByPackage: Readonly<Record<string, string | undefined>>
  readings: readonly ObligationReading[]
}): { owed: OwedFollowUp[]; skipped: SkippedObligation[] } {
  const cfg = { __proto__: null, ...config } as typeof config
  const owed: OwedFollowUp[] = []
  const skipped: SkippedObligation[] = []
  // First pass: direct readings.
  const owedByRepo = new Set<string>()
  const readableByRepo = new Set<string>()
  for (const reading of cfg.readings) {
    const { declared, edge, pkg, readable, source } = reading
    const latest = cfg.latestByPackage[pkg]
    if (latest === undefined) {
      skipped.push({
        detail: `registry latest for ${pkg} unknown this run — ${source}`,
        edge,
        pkg,
      })
      continue
    }
    if (!readable) {
      skipped.push({ detail: source, edge, pkg })
      continue
    }
    readableByRepo.add(`${pkg}\x00${edge.repo}`)
    if (declared !== undefined && compareVersionsLoose(declared, latest) >= 0) {
      continue
    }
    owedByRepo.add(`${pkg}\x00${edge.repo}`)
    owed.push({
      action: owedAction({ declared, edge, latest, pkg }),
      declared,
      edge,
      latest,
      pkg,
    })
  }
  // Second pass: derive follow-up-release edges from their siblings. Only
  // packages the caller put IN SCOPE — a key in latestByPackage, even an
  // unknown-latest one — derive; the rest of the graph stays out of this run.
  for (const [pkg, decls] of Object.entries(RELEASE_CASCADE_GRAPH)) {
    if (!(pkg in cfg.latestByPackage)) {
      continue
    }
    const latest = cfg.latestByPackage[pkg]
    for (const decl of decls) {
      if (decl.kind !== 'follow-up-release') {
        continue
      }
      const edge: CascadeEdge = { kind: decl.kind, repo: decl.repo }
      if (latest === undefined) {
        skipped.push({
          detail: `registry latest for ${pkg} unknown this run`,
          edge,
          pkg,
        })
        continue
      }
      const repoKey = `${pkg}\x00${decl.repo}`
      if (owedByRepo.has(repoKey)) {
        owed.push({
          action: owedAction({ declared: undefined, edge, latest, pkg }),
          declared: undefined,
          edge,
          latest,
          pkg,
        })
      } else if (!readableByRepo.has(repoKey)) {
        skipped.push({
          detail: `no readable sibling observation for ${decl.repo} this run — cannot derive`,
          edge,
          pkg,
        })
      }
    }
  }
  return { owed, skipped }
}

/**
 * The owed list a JUST-CUT release creates, rendered as printable lines. At
 * release time every downstream declaration lags by definition — the new
 * version became latest moments ago — so this is the graph read straight,
 * with the action per edge. Empty for a package with no obligations; callers
 * print nothing then. Consumed by the approve/reconcile release stages and
 * the tag-gap healer's job summary.
 */
export function renderOwedAfterRelease(
  pkgName: string,
  version: string,
): string[] {
  const edges = flattenObligations(pkgName)
  if (!edges.length) {
    return []
  }
  const lines = [
    `release-cascade: ${pkgName}@${version} creates downstream obligations —`,
  ]
  for (const edge of edges) {
    const action =
      edge.kind === 'follow-up-release'
        ? `cut a ${edge.repo} release once ${pkgName}@${version} is absorbed`
        : owedAction({
            declared: undefined,
            edge,
            latest: version,
            pkg: pkgName,
          }).replace(' — saw no entry', '')
    lines.push(`  - ${edge.kind} ${edge.repo}: ${action}`)
  }
  lines.push(
    '  verify: node scripts/fleet/check/cascade-followups-are-settled.mts — red until the train completes',
  )
  return lines
}
