/**
 * @file The ONE release-subject resolver. A repo's publishable subject is
 *   usually its root package.json, but a monorepo can redirect the publish via
 *   `publishConfig.directory` — pnpm then packs and publishes THAT directory
 *   instead of the root, so the published name, version, README, CHANGELOG,
 *   and the `pnpm pack` output directory all belong to the subject manifest,
 *   not the root one. Every publish/release/reconcile consumer resolves the
 *   subject through here — never a per-site `path.join(root, 'package.json')`
 *   reimplementation — so a redirected repo like socket-registry behaves
 *   exactly like a plain one downstream. Dependency-free by design: node
 *   builtins only, loadable on a bare checkout — the release-reconcile gap job
 *   imports this before any pnpm install.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The resolved publish subject. For a plain repo every path points at the
 * root; for a `publishConfig.directory` redirect they point into the subject
 * directory. `packDir` is where `pnpm pack` writes the tarball — verified
 * against live pnpm: with a redirect the tarball lands INSIDE the directory,
 * named from the subject manifest.
 */
export interface ReleaseSubject {
  changelogPath: string
  dir: string
  manifestPath: string
  name: string
  packDir: string
  private?: boolean | undefined
  readmePath: string
  redirected: boolean
  repository?: string | { url?: string | undefined } | undefined
  rootPath: string
  version: string
}

interface ManifestShape {
  name?: unknown | undefined
  private?: unknown | undefined
  publishConfig?: { directory?: unknown | undefined } | undefined
  repository?: string | { url?: string | undefined } | undefined
  version?: unknown | undefined
}

function readManifest(manifestPath: string): ManifestShape {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestShape
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Resolve the publish subject for the repo at `rootPath`, honoring
 * `publishConfig.directory` when present and defaulting to the root shape —
 * byte-identical behavior for every plain single-package repo. Throws LOUD
 * when a declared redirect is broken: a non-string/empty directory, a
 * directory escaping the repo root, a missing subject manifest, or a subject
 * manifest with no name/version — a publish must never fall back to the
 * private root manifest and stage the wrong package.
 */
export function resolveReleaseSubject(rootPath: string): ReleaseSubject {
  const rootManifestPath = path.join(rootPath, 'package.json')
  const root = readManifest(rootManifestPath)
  const directory = root.publishConfig?.directory
  if (directory === undefined) {
    return {
      changelogPath: path.join(rootPath, 'CHANGELOG.md'),
      dir: rootPath,
      manifestPath: rootManifestPath,
      name: asString(root.name),
      packDir: rootPath,
      private: typeof root.private === 'boolean' ? root.private : undefined,
      readmePath: path.join(rootPath, 'README.md'),
      redirected: false,
      repository: root.repository,
      rootPath,
      version: asString(root.version),
    }
  }
  if (typeof directory !== 'string' || !directory) {
    throw new Error(
      `publishConfig.directory in ${rootManifestPath} must be a non-empty ` +
        `package-relative path string, saw ${JSON.stringify(directory)}.`,
    )
  }
  const dir = path.resolve(rootPath, directory)
  const rel = path.relative(rootPath, dir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `publishConfig.directory ${JSON.stringify(directory)} in ` +
        `${rootManifestPath} must resolve to a subdirectory of the repo ` +
        `root — pnpm publishes that directory INSTEAD of the root.`,
    )
  }
  const manifestPath = path.join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `publishConfig.directory ${JSON.stringify(directory)} in ` +
        `${rootManifestPath} points at a directory with no package.json — ` +
        `expected the publish subject's manifest at ${manifestPath}.`,
    )
  }
  const subject = readManifest(manifestPath)
  const name = asString(subject.name)
  const version = asString(subject.version)
  if (!name || !version) {
    throw new Error(
      `the publish subject manifest ${manifestPath} must carry a name and a ` +
        `version, saw name=${JSON.stringify(subject.name)} ` +
        `version=${JSON.stringify(subject.version)}.`,
    )
  }
  return {
    changelogPath: path.join(dir, 'CHANGELOG.md'),
    dir,
    manifestPath,
    name,
    packDir: dir,
    private: typeof subject.private === 'boolean' ? subject.private : undefined,
    readmePath: path.join(dir, 'README.md'),
    redirected: true,
    // The subject manifest's repository wins; the root's is the fallback so a
    // subject that omits it still pins README assets to the right repo.
    repository: subject.repository ?? root.repository,
    rootPath,
    version,
  }
}
