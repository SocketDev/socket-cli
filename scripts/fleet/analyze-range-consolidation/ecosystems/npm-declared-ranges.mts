/*
 * @file Where a pnpm consumer's DECLARED range actually comes from. The
 *   resolution graph is the easy half; a lockfile records what pnpm PICKED, and
 *   only some of what each consumer ASKED FOR. This module is the four places
 *   the asking is written down:
 *
 *   1. An importer's `specifier:` field. Present for every workspace
 *      declaration, but often indirect — `catalog:` defers to the workspace
 *      catalog, `npm:other@1.2.3` aliases another package, `workspace:*` and
 *      `link:` name a local path and carry no registry range at all.
 *   2. The `catalogs:` section, which is where a `catalog:` specifier lands.
 *      Reading it from the lockfile rather than `pnpm-workspace.yaml` keeps the
 *      range and the resolution it produced in one file.
 *   3. A `packages:` entry's `peerDependencies:` block — the one declared range
 *      a published dependency writes into the lockfile itself.
 *   4. The dependency's own installed manifest under the virtual store, for
 *      every ordinary transitive `dependencies:` range, which the lockfile
 *      records only as a resolution.
 *
 *   Every reader returns a REASON when it cannot produce a range. An
 *   unresolvable `catalog:` reference, a `workspace:` specifier, a manifest that
 *   is not installed — each has to stay distinguishable from "declares nothing",
 *   because `verdict.mts` treats an unread range as blindness and refuses to
 *   judge the family, which is the correct answer and only works if the reason
 *   travels with it.
 *
 *   The `overrides:` reader is here for the same reason the analyzer cares about
 *   overrides at all: a family that already carries one yet needs no widening is
 *   an override that never had to exist.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import {
  parsePnpmDepPathKeyLine,
  parsePnpmNestedEntry,
  stripYamlQuotes,
} from '../../_shared/pnpm-lockfile.mts'

// A 2-space `<catalog>:` key inside `catalogs:` with no inline value.
const CATALOG_NAME_RE = /^ {2}(?!\s)'?([^'\n]+?)'?:\s*$/
// A 4-space `<package>:` key inside one catalog, with no inline value.
const CATALOG_ENTRY_RE = /^ {4}(?!\s)'?([^'\n]+?)'?:\s*$/
// The 6-space `specifier:` line under a catalog entry — the declared range the
// catalog centralizes.
const CATALOG_SPECIFIER_RE = /^ {6}(?!\s)specifier:\s*(.+)$/
// A 2-space `<key>: <value>` line inside `overrides:`, always inline.
const OVERRIDE_ENTRY_RE = /^ {2}(?!\s)'?([^'\n]+?)'?:\s*(.+)$/
// An override key: a package name, optionally narrowed by an `@<range>` suffix
// (`brace-expansion@>=4`, `semver@>=5.0.0 <7.6.0`). Group 1 is the name.
const OVERRIDE_KEY_RE = /^((?:@[^@/]+\/)?[^@]+)(?:@(.+))?$/
// An `npm:` alias specifier — `npm:@socketregistry/gopd@1.0.7`. Group 2 is the
// declared range against the aliased package.
const NPM_ALIAS_SPECIFIER_RE = /^npm:((?:@[^@/]+\/)?[^@]+)@(.+)$/
// A 4-space key inside a `packages:` entry, which ends any block before it.
const PACKAGE_FIELD_RE = /^ {4}(?!\s)([A-Za-z]+):/

// A specifier prefix that names a location rather than a registry range. None of
// these can be intersected with a semver range, so each one is a reason rather
// than a range.
const NON_REGISTRY_SPECIFIER_PREFIXES: readonly string[] = [
  'file:',
  'git+',
  'git:',
  'http:',
  'https:',
  'link:',
  'portal:',
  'workspace:',
]

export const PNPM_CATALOG_PREFIX = 'catalog:'
export const PNPM_DEFAULT_CATALOG = 'default'

// Catalog name → package name → the declared specifier that catalog centralizes.
export type PnpmCatalogSpecifiers = Map<string, Map<string, string>>

// Bare dep path (`<name>@<version>`) → peer package name → declared peer range.
export type PnpmPeerRanges = Map<string, Map<string, string>>

export interface DeclaredRangeResolution {
  readonly range: string | undefined
  // Where the range was read, or where the reading stopped.
  readonly source: string
  readonly unreadableReason: string | undefined
}

// An `npm:` alias specifier split into the package it aliases and the range it
// declares against that package.
export interface NpmAliasSpecifier {
  readonly name: string
  readonly range: string
}

// An `overrides:` key split into the package it forces and the optional
// `@<range>` suffix narrowing which declared specs it rewrites.
export interface PnpmOverrideKey {
  readonly name: string
  readonly scopeRange: string | undefined
}

/**
 * Read the lockfile's `catalogs:` section — the declared range every `catalog:`
 * specifier defers to.
 */
export function collectPnpmCatalogSpecifiers(
  lines: readonly string[],
): PnpmCatalogSpecifiers {
  const catalogs: PnpmCatalogSpecifiers = new Map()
  let inSection = false
  let catalog: Map<string, string> | undefined
  let entryName: string | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'catalogs:') {
      inSection = true
      catalog = undefined
      entryName = undefined
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
    const nameMatch = CATALOG_NAME_RE.exec(line)
    if (nameMatch) {
      catalog = new Map()
      catalogs.set(nameMatch[1]!, catalog)
      entryName = undefined
      continue
    }
    if (!catalog) {
      continue
    }
    const specifierMatch = CATALOG_SPECIFIER_RE.exec(line)
    if (specifierMatch && entryName !== undefined) {
      catalog.set(entryName, stripYamlQuotes(specifierMatch[1]!.trim()))
      continue
    }
    const entryMatch = CATALOG_ENTRY_RE.exec(line)
    if (entryMatch) {
      entryName = entryMatch[1]!
    }
  }
  return catalogs
}

/**
 * An `overrides:` key split into the package it forces and its optional
 * `@<range>` narrowing suffix. Returns `undefined` for a key that is not a
 * package reference.
 */
export function parsePnpmOverrideKey(key: string): PnpmOverrideKey | undefined {
  const m = OVERRIDE_KEY_RE.exec(key)
  return m ? { name: m[1]!, scopeRange: m[2] } : undefined
}

/**
 * The package name out of an `overrides:` key, dropping any `@<range>`
 * narrowing suffix. Returns `undefined` for a key that is not a package
 * reference.
 */
export function parsePnpmOverrideKeyName(key: string): string | undefined {
  return parsePnpmOverrideKey(key)?.name
}

/**
 * Every entry the lockfile's `overrides:` section applies, raw key to raw
 * value. The key keeps any `@<range>` narrowing so a scoped entry stays
 * distinguishable, and the value is what the resolver actually forced: pnpm
 * writes a `catalog:` override into the lockfile already reduced to the version
 * the catalog carries.
 */
export function collectPnpmOverrideEntries(
  lines: readonly string[],
): Map<string, string> {
  const entries = new Map<string, string>()
  let inSection = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'overrides:') {
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
    const entryMatch = OVERRIDE_ENTRY_RE.exec(line)
    if (entryMatch) {
      entries.set(entryMatch[1]!, stripYamlQuotes(entryMatch[2]!.trim()))
    }
  }
  return entries
}

/**
 * Every package name the lockfile's `overrides:` section forces, range-narrowed
 * keys included. A name here is a family whose collapse was already paid for
 * with an override.
 */
export function collectPnpmOverriddenNames(
  lines: readonly string[],
): Set<string> {
  const names = new Set<string>()
  for (const key of collectPnpmOverrideEntries(lines).keys()) {
    const name = parsePnpmOverrideKeyName(key)
    if (name !== undefined) {
      names.add(name)
    }
  }
  return names
}

/**
 * Read every `packages:` entry's `peerDependencies:` block. A peer range is the
 * one declared constraint a published dependency writes into the lockfile, so
 * it is readable without an installed tree.
 */
export function collectPnpmPeerRanges(
  lines: readonly string[],
): PnpmPeerRanges {
  const peers: PnpmPeerRanges = new Map()
  let inSection = false
  let depPath: string | undefined
  let inPeerBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (line === 'packages:') {
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
    const key = parsePnpmDepPathKeyLine(line)
    if (key) {
      depPath = `${key.name}@${key.version}`
      inPeerBlock = false
      continue
    }
    const fieldMatch = PACKAGE_FIELD_RE.exec(line)
    if (fieldMatch) {
      inPeerBlock = fieldMatch[1] === 'peerDependencies'
      continue
    }
    if (!inPeerBlock || depPath === undefined) {
      continue
    }
    const entry = parsePnpmNestedEntry(line)
    if (entry) {
      let byName = peers.get(depPath)
      if (!byName) {
        byName = new Map()
        peers.set(depPath, byName)
      }
      byName.set(entry.name, stripYamlQuotes(entry.value.trim()))
    }
  }
  return peers
}

/**
 * Reduce an importer's raw `specifier:` to a registry range, following one
 * `catalog:` hop. Every path that cannot produce a range says why: a
 * `workspace:`/`link:` specifier names a location, a `catalog:` reference can
 * miss, and an absent specifier is a lockfile shape this reader does not know.
 */
export function resolveNpmDeclaredRange(config: {
  readonly catalogs: PnpmCatalogSpecifiers
  readonly name: string
  readonly specifier: string | undefined
}): DeclaredRangeResolution {
  const { catalogs, name, specifier } = config
  if (specifier === undefined) {
    return {
      range: undefined,
      source: 'pnpm-lock.yaml importers',
      unreadableReason: 'the lockfile records no specifier for the declaration',
    }
  }
  if (specifier.startsWith(PNPM_CATALOG_PREFIX)) {
    const catalogName =
      specifier.slice(PNPM_CATALOG_PREFIX.length) || PNPM_DEFAULT_CATALOG
    const entry = catalogs.get(catalogName)?.get(name)
    const source = `pnpm-lock.yaml catalogs.${catalogName}.${name}.specifier`
    if (entry === undefined) {
      return {
        range: undefined,
        source,
        unreadableReason: `catalog \`${catalogName}\` has no entry for ${name}`,
      }
    }
    const resolved = reduceNpmSpecifier(entry)
    return { ...resolved, source }
  }
  return {
    ...reduceNpmSpecifier(specifier),
    source: 'pnpm-lock.yaml importers',
  }
}

/**
 * An `npm:` alias specifier split into the package it aliases and the range it
 * declares against it. Returns `undefined` for any other specifier.
 */
export function parseNpmAliasSpecifier(
  specifier: string,
): NpmAliasSpecifier | undefined {
  const m = NPM_ALIAS_SPECIFIER_RE.exec(specifier)
  return m ? { name: m[1]!, range: m[2]! } : undefined
}

/**
 * Reduce a non-`catalog:` specifier to a registry range. An `npm:` alias
 * carries its range after the aliased package's name; a location specifier
 * carries none.
 */
export function reduceNpmSpecifier(specifier: string): {
  range: string | undefined
  unreadableReason: string | undefined
} {
  const alias = parseNpmAliasSpecifier(specifier)
  if (alias) {
    return { range: alias.range, unreadableReason: undefined }
  }
  const prefix = NON_REGISTRY_SPECIFIER_PREFIXES.find(candidate =>
    specifier.startsWith(candidate),
  )
  if (prefix) {
    return {
      range: undefined,
      unreadableReason: `a \`${prefix}\` specifier names a location, not a registry range`,
    }
  }
  if (specifier === '') {
    return { range: undefined, unreadableReason: 'the specifier is empty' }
  }
  return { range: specifier, unreadableReason: undefined }
}

/**
 * The virtual-store folder names, or an empty list when the store is absent.
 * Read once per run because a dep path maps to a folder by prefix: pnpm escapes
 * `/` to `+` and appends a `_<peers>` suffix when a package resolved against
 * peers, so the folder for `<name>@<version>` cannot be spelled from the dep
 * path alone.
 */
export function readPnpmVirtualStoreEntries(
  virtualStoreDir: string,
): readonly string[] {
  try {
    return readdirSync(virtualStoreDir)
  } catch {
    return []
  }
}

/**
 * The installed manifest for a resolved dep path, or `undefined` when no
 * virtual-store folder matches it.
 */
export function findPnpmInstalledManifest(config: {
  readonly name: string
  readonly storeEntries: readonly string[]
  readonly version: string
  readonly virtualStoreDir: string
}): string | undefined {
  const { name, storeEntries, version, virtualStoreDir } = config
  const prefix = `${name.replaceAll('/', '+')}@${version}`
  for (let i = 0, { length } = storeEntries; i < length; i += 1) {
    const entry = storeEntries[i]!
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) {
      continue
    }
    const manifestPath = path.join(
      virtualStoreDir,
      entry,
      'node_modules',
      name,
      'package.json',
    )
    if (existsSync(manifestPath)) {
      return manifestPath
    }
  }
  return undefined
}

// The manifest fields a declared range for a given dependency can sit in, in the
// order pnpm resolves them.
const MANIFEST_RANGE_FIELDS: readonly string[] = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]

/**
 * The range a consumer's own installed manifest declares for one dependency. An
 * uninstalled or unparsable manifest is a REASON, never an absent constraint —
 * the family it belongs to has to stay unjudged rather than be judged blind.
 */
export function readPnpmManifestDeclaredRange(config: {
  readonly dependencyName: string
  readonly manifestPath: string
}): DeclaredRangeResolution {
  const { dependencyName, manifestPath } = config
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch (e) {
    return {
      range: undefined,
      source: manifestPath,
      unreadableReason: `its installed manifest could not be read (${errorMessage(e)})`,
    }
  }
  for (let i = 0, { length } = MANIFEST_RANGE_FIELDS; i < length; i += 1) {
    const field = MANIFEST_RANGE_FIELDS[i]!
    const block = parsed[field]
    if (block === null || typeof block !== 'object') {
      continue
    }
    const range = (block as Record<string, unknown>)[dependencyName]
    if (typeof range === 'string') {
      return {
        range,
        source: `${manifestPath} ${field}.${dependencyName}`,
        unreadableReason: undefined,
      }
    }
  }
  return {
    range: undefined,
    source: manifestPath,
    unreadableReason: `its installed manifest declares no range for ${dependencyName}`,
  }
}
