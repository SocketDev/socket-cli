/*
 * @file Multi-package npm workspace layout resolution for the publish engine.
 *   A repo's publishable npm surface is DERIVED, never declared twice: the
 *   pnpm-workspace.yaml `packages:` globs name the members, `private: false`
 *   (absent) + name + version marks a member publishable, and the
 *   `<package>/scripts/make-npm-dirs.mts` + `<package>/npm/<platformId>/`
 *   convention marks generated platform packages (napi prebuilt-binary
 *   carriers) even when they are not workspace members themselves. Layout
 *   kinds:
 *
 *   - `single` — the root manifest is publishable (or redirects via
 *     `publishConfig.directory`), the socket-lib / socket-registry shape. The
 *     existing single-subject machinery owns everything; this module changes
 *     NOTHING for these repos.
 *   - `multi` — the root manifest is private/versionless and the publishable
 *     packages are workspace members (decmpfs: `napi/decmpfs` +
 *     `napi/decmpfs/npm/<platformId>`; stuie: `packages/*` +
 *     `packages/core/npm/<platformId>`). The MAIN package anchors the registry
 *     history; the version source is the root manifest when it carries a
 *     version, else the main package; every publishable manifest moves in
 *     lockstep. The pure planning helpers over a resolved layout (lockstep
 *     writes, publish order, hollow detection) live in workspace-plan.mts; the
 *     fs-reading resolvers here fail LOUD (What / Where / Saw-vs-wanted / Fix),
 *     never silently fall back to a private root manifest.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { parseListBlock } from '../../lib/workspace-yaml.mts'
import { resolveReleaseSubject } from '../../_shared/release-subject.mts'

import type { ReleaseSubject } from '../../_shared/release-subject.mts'

export interface WorkspaceManifestShape {
  cpu?: string[] | undefined
  dependencies?: Record<string, string> | undefined
  files?: string[] | undefined
  main?: string | undefined
  name?: string | undefined
  optionalDependencies?: Record<string, string> | undefined
  os?: string[] | undefined
  peerDependencies?: Record<string, string> | undefined
  private?: boolean | undefined
  publishConfig?: { directory?: unknown | undefined } | undefined
  repository?: string | { url?: string | undefined } | undefined
  version?: string | undefined
}

export interface WorkspacePackage {
  dir: string
  /**
   * Absolute path of this package's platform-package generator
   * (`<dir>/scripts/make-npm-dirs.mts`) when it owns generated
   * `npm/<platformId>/` dirs. The engine INVOKES it, never reimplements it.
   */
  generatorPath: string | undefined
  manifest: WorkspaceManifestShape
  manifestPath: string
  name: string
  /**
   * True for a generated platform package — a publishable dir under another
   * publishable package's `npm/` directory, carrying a prebuilt payload.
   */
  platform: boolean
  /**
   * Owning loader package's name when `platform` is true.
   */
  platformOwner: string | undefined
  relDir: string
  relManifestPath: string
  version: string
}

export interface WorkspaceVersionSource {
  /**
   * The package name whose registry history anchors the release.
   */
  name: string
  relManifestPath: string
  version: string
}

export interface NpmWorkspaceLayout {
  kind: 'multi' | 'single'
  /**
   * The registry-anchor package for a multi layout; undefined for single.
   */
  main: WorkspacePackage | undefined
  /**
   * Publishable packages for a multi layout; empty for single.
   */
  packages: WorkspacePackage[]
  repository: string | { url?: string | undefined } | undefined
  rootPath: string
  /**
   * The resolved single-package publish subject; undefined for multi.
   */
  subject: ReleaseSubject | undefined
  versionSource: WorkspaceVersionSource
}

const GENERATOR_REL_PATH = path.join('scripts', 'make-npm-dirs.mts')

function readManifest(
  manifestPath: string,
): WorkspaceManifestShape | undefined {
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(raw) as WorkspaceManifestShape
  } catch {
    return undefined
  }
}

function isPublishableManifest(
  manifest: WorkspaceManifestShape | undefined,
): manifest is WorkspaceManifestShape & { name: string; version: string } {
  return (
    !!manifest &&
    manifest.private !== true &&
    typeof manifest.name === 'string' &&
    manifest.name.length > 0 &&
    typeof manifest.version === 'string' &&
    manifest.version.length > 0
  )
}

/**
 * Expand one pnpm-workspace `packages:` glob against the real tree. Segment
 * -wise: a `*` segment expands to every child directory at that depth
 * (matching pnpm's single-level semantics for `dir/*`); literal segments must
 * exist. `**` is not expanded — the fleet's workspace files use literal paths
 * and single-level `dir/*` globs only. Exported for tests.
 */
export function expandWorkspaceGlob(rootPath: string, glob: string): string[] {
  const segments = normalizePath(glob).split('/').filter(Boolean)
  let dirs = [rootPath]
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const next: string[] = []
    for (let j = 0, dirCount = dirs.length; j < dirCount; j += 1) {
      const dir = dirs[j]!
      if (segment === '*') {
        let children: string[]
        try {
          children = readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(dir, entry.name))
        } catch {
          continue
        }
        next.push(...children.toSorted())
      } else if (segment.includes('*')) {
        // Partial-wildcard segments (`pkg-*`) are not used by fleet workspace
        // files; matching nothing here keeps the expansion honest (the caller
        // sees the member missing and fails loud downstream, never a silent
        // partial expansion).
        continue
      } else {
        const child = path.join(dir, segment)
        if (existsSync(child)) {
          next.push(child)
        }
      }
    }
    dirs = next
  }
  return dirs
}

/**
 * Discover the repo's publishable workspace packages: expand the
 * pnpm-workspace.yaml `packages:` globs (honoring `!` negations), keep the
 * dirs whose manifest is publishable (`private` !== true, has name +
 * version), then add generated platform packages by convention — any
 * publishable `npm/<platformId>/` dir under a discovered package that owns a
 * `scripts/make-npm-dirs.mts` generator — even when those dirs are not
 * workspace members (the stuie shape). Deduped by dir, sorted by relDir.
 */
export function discoverWorkspacePackages(
  rootPath: string,
): WorkspacePackage[] {
  const workspaceYamlPath = path.join(rootPath, 'pnpm-workspace.yaml')
  let globs: string[] = []
  if (existsSync(workspaceYamlPath)) {
    globs = parseListBlock(readFileSync(workspaceYamlPath, 'utf8'), {
      blockKey: 'packages',
    })
  }
  const included = new Set<string>()
  const excluded = new Set<string>()
  for (let i = 0, { length } = globs; i < length; i += 1) {
    const glob = globs[i]!
    const negated = glob.startsWith('!')
    const target = negated ? excluded : included
    const dirs = expandWorkspaceGlob(rootPath, negated ? glob.slice(1) : glob)
    for (let j = 0, dirCount = dirs.length; j < dirCount; j += 1) {
      target.add(dirs[j]!)
    }
  }
  const byDir = new Map<string, WorkspacePackage>()
  function addPackage(dir: string): WorkspacePackage | undefined {
    const known = byDir.get(dir)
    if (known) {
      return known
    }
    const manifestPath = path.join(dir, 'package.json')
    const manifest = readManifest(manifestPath)
    if (!isPublishableManifest(manifest)) {
      return undefined
    }
    const generatorPath = path.join(dir, GENERATOR_REL_PATH)
    const pkg: WorkspacePackage = {
      dir,
      generatorPath: existsSync(generatorPath) ? generatorPath : undefined,
      manifest,
      manifestPath,
      name: manifest.name,
      platform: false,
      platformOwner: undefined,
      relDir: normalizePath(path.relative(rootPath, dir)),
      relManifestPath: normalizePath(path.relative(rootPath, manifestPath)),
      version: manifest.version,
    }
    byDir.set(dir, pkg)
    return pkg
  }
  for (const dir of included) {
    if (dir === rootPath || excluded.has(dir)) {
      continue
    }
    addPackage(dir)
  }
  // Generated platform packages by convention: a generator-owning package's
  // `npm/<platformId>/` children are publishable platform packages even when
  // the workspace globs don't list them (stuie's packages/core/npm/*).
  const owners = [...byDir.values()]
  for (let i = 0, { length } = owners; i < length; i += 1) {
    const owner = owners[i]!
    if (!owner.generatorPath) {
      continue
    }
    const npmDir = path.join(owner.dir, 'npm')
    if (!existsSync(npmDir)) {
      continue
    }
    const entries = readdirSync(npmDir, { withFileTypes: true })
    for (let j = 0, entryCount = entries.length; j < entryCount; j += 1) {
      const entry = entries[j]!
      if (entry.isDirectory()) {
        addPackage(path.join(npmDir, entry.name))
      }
    }
  }
  // Classify platform packages: any publishable package under another
  // publishable package's `npm/` dir carries that owner's prebuilt payload.
  const packages = [...byDir.values()]
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    for (let j = 0; j < packages.length; j += 1) {
      const owner = packages[j]!
      if (
        pkg !== owner &&
        normalizePath(pkg.dir).startsWith(
          `${normalizePath(path.join(owner.dir, 'npm'))}/`,
        )
      ) {
        pkg.platform = true
        pkg.platformOwner = owner.name
        break
      }
    }
  }
  return packages.toSorted((a, b) => a.relDir.localeCompare(b.relDir))
}

function selectMainPackage(
  packages: readonly WorkspacePackage[],
  rootPath: string,
): WorkspacePackage {
  const loaders = packages.filter(pkg => !pkg.platform)
  if (loaders.length === 1) {
    return loaders[0]!
  }
  const generatorOwners = loaders.filter(pkg => pkg.generatorPath)
  if (generatorOwners.length === 1) {
    return generatorOwners[0]!
  }
  throw new Error(
    `Cannot determine the MAIN npm package for this workspace.\n` +
      `  Where: ${path.join(rootPath, 'pnpm-workspace.yaml')}\n` +
      `  Saw vs wanted: ${loaders.length} non-platform publishable ` +
      `package(s) (${loaders.map(pkg => pkg.name).join(', ') || 'none'}) and ` +
      `${generatorOwners.length} platform-package generator owner(s); wanted ` +
      `exactly one of either to anchor the release.\n` +
      `  Fix: keep exactly one workspace package owning the ` +
      `scripts/make-npm-dirs.mts generator (the loader package), or mark the ` +
      `non-publishable members "private": true so one main remains.`,
  )
}

/**
 * Resolve the repo's npm publish layout. `single` — byte-identical to the
 * existing engine behavior — whenever the root manifest is itself publishable
 * or redirects via `publishConfig.directory`. `multi` when the root is
 * private/versionless and publishable workspace members exist. Throws LOUD
 * when neither shape resolves (a versionless root with no publishable
 * members) — a publish must never guess its subject.
 */
export function resolveNpmWorkspaceLayout(
  rootPath: string,
): NpmWorkspaceLayout {
  const rootManifestPath = path.join(rootPath, 'package.json')
  const root = readManifest(rootManifestPath)
  const rootRedirects = root?.publishConfig?.directory !== undefined
  if (rootRedirects || isPublishableManifest(root)) {
    const subject = resolveReleaseSubject(rootPath)
    return {
      kind: 'single',
      main: undefined,
      packages: [],
      repository: subject.repository,
      rootPath,
      subject,
      versionSource: {
        name: subject.name,
        relManifestPath: normalizePath(
          path.relative(rootPath, subject.manifestPath),
        ),
        version: subject.version,
      },
    }
  }
  const packages = discoverWorkspacePackages(rootPath)
  if (packages.length === 0) {
    if (typeof root?.version === 'string' && root.version) {
      // A private, versioned root with no publishable members: the
      // bump-only shape (the wheelhouse itself). The root stays the subject.
      const subject = resolveReleaseSubject(rootPath)
      return {
        kind: 'single',
        main: undefined,
        packages: [],
        repository: subject.repository,
        rootPath,
        subject,
        versionSource: {
          name: subject.name,
          relManifestPath: 'package.json',
          version: subject.version,
        },
      }
    }
    throw new Error(
      `No publishable npm package found in this repo.\n` +
        `  Where: ${rootManifestPath}\n` +
        `  Saw vs wanted: a root manifest with no version (private workspace ` +
        `root) and no pnpm-workspace member with private !== true + name + ` +
        `version; wanted either a publishable root or at least one ` +
        `publishable workspace package.\n` +
        `  Fix: give the publishable package a name + version (drop ` +
        `"private": true), or list its directory under packages: in ` +
        `pnpm-workspace.yaml.`,
    )
  }
  const main = selectMainPackage(packages, rootPath)
  const rootHasVersion = typeof root?.version === 'string' && !!root.version
  return {
    kind: 'multi',
    main,
    packages,
    repository: root?.repository ?? main.manifest.repository,
    rootPath,
    subject: undefined,
    versionSource: {
      name: main.name,
      relManifestPath: rootHasVersion ? 'package.json' : main.relManifestPath,
      version: rootHasVersion ? String(root!.version) : main.version,
    },
  }
}

/**
 * The set of package names this repo publishes — the approve flow's
 * "ours" filter. Single layout: the subject name. Multi: every publishable
 * member.
 */
export function workspacePublishableNames(rootPath: string): Set<string> {
  const layout = resolveNpmWorkspaceLayout(rootPath)
  if (layout.kind === 'single') {
    return new Set([layout.versionSource.name])
  }
  return new Set(layout.packages.map(pkg => pkg.name))
}

/**
 * Find the publishable package (or single subject) that publishes `name`.
 * Returns its directory + platform flag, or undefined when this repo does not
 * publish `name` (the cross-repo staged-entry case).
 */
export function findWorkspacePackageByName(
  layout: NpmWorkspaceLayout,
  name: string,
): WorkspacePackage | undefined {
  if (layout.kind === 'single') {
    return undefined
  }
  return layout.packages.find(pkg => pkg.name === name)
}
