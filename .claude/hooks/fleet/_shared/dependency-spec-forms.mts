/*
 * @file Shared dependency-spec classifier — the single source consumed by the
 *   `link-protocol-dep-guard` hook (edit-time) and the
 *   `dependency-specs-are-registry-or-workspace` check, committed state.
 *
 *   A fleet dependency spec must be a PIN, and the fleet has a PREFERENCE
 *   ORDER among the pinned forms (`docs/agents.md/fleet/dependency-spec-pinning.md`):
 *
 *     1. catalog:          PREFERRED. A fleet catalog entry, itself
 *                          exact-pinned in `.config/fleet/pnpm-workspace.fleet.yaml`.
 *                          One central bump upgrades every repo at once.
 *     2. 1.2.3             A published package at an exact version. Correct,
 *                          but it is a per-manifest bump forever after.
 *        npm:other@1.2.3   An aliased published package at an exact version.
 *     3. workspace:1.2.3   FALLBACK, for an intra-repo package that genuinely
 *                          cannot be published. Every sibling release forces a
 *                          manifest bump in each dependent, which is exactly
 *                          the cost `catalog:` removes.
 *
 *   Four spec shapes fall outside or below that contract:
 *
 *   1. `local-path` — `link:` or `file:`. The dependency resolves to a
 *      directory on the installing machine, which means the package it names
 *      is UNPUBLISHED. That is a publishing gap, not a formatting nit: the
 *      fix is to publish the package (reserve the name + wire trusted
 *      publishing via `scripts/fleet/publish-infra/{npm,cargo}/`), add it to
 *      the fleet catalog, and depend on it via `catalog:`. Narrowing a
 *      `packages:` glob is the rarer case.
 *   2. `workspace-range` — `workspace:*`, `workspace:^`, `workspace:^1.2.3`,
 *      `workspace:~1.2.3`. A range floats: which sibling version an install
 *      resolves depends on the tree it runs against, and pnpm expands the
 *      range at publish time into a range consumers inherit.
 *   3. `registry-range` — a bare `^1.2.3` / `~1.2.3` / `>=5.0.0` / `a || b`.
 *      Same floating problem against the registry. `peerDependencies` are
 *      exempt: a peer dep states the span of host versions it works with, so
 *      a range there is the correct expression, not a missing pin.
 *   4. `workspace-pin` — `workspace:1.2.3`. A legal pin, reported so the
 *      fleet can see the `catalog:` conversion backlog. Never blocked: a repo
 *      whose sibling is not published yet has nowhere else to go.
 *
 *   Kinds 1-2 block. Kinds 3-4 are advisory — `isBlockingSpecKind` is the seam.
 */

// Dependency blocks whose values are always a bare spec string.
export const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

// Override blocks nest arbitrarily deep — `overrides: { foo: { bar: '1' } }`
// and `overrides: { 'foo@2': { '.': '3' } }` are both legal — so these are
// walked recursively rather than read one level down.
export const OVERRIDE_FIELDS = ['overrides', 'resolutions'] as const

// Local-path protocols. Both are violations wherever they appear.
export const LOCAL_PROTOCOLS = ['file:', 'link:'] as const

// A bare exact semver, optionally with a prerelease and/or build tail.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

// Spec forms that carry their own identity scheme and are classified by the
// dedicated predicates below rather than by range shape.
const NON_RANGE_PREFIXES = [
  'catalog:',
  'file:',
  'git+',
  'git:',
  'github:',
  'http:',
  'https:',
  'link:',
  'npm:',
  'workspace:',
] as const

export type DependencySpecKind =
  | 'local-path'
  | 'registry-range'
  | 'workspace-pin'
  | 'workspace-range'

export interface DependencySpecFinding {
  readonly field: string
  readonly kind: DependencySpecKind
  readonly name: string
  readonly value: string
}

// Return the local-path protocol a spec uses (`link` / `file`), or `undefined`
// when the spec is a registry version, `workspace:`, `catalog:`, a git URL, or
// anything else that is not a filesystem path.
export function localPathProtocol(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  for (let i = 0, { length } = LOCAL_PROTOCOLS; i < length; i += 1) {
    const protocol = LOCAL_PROTOCOLS[i]!
    if (value.startsWith(protocol)) {
      return protocol.slice(0, -1)
    }
  }
  return undefined
}

// Whether a spec names a workspace member by RANGE instead of exact version.
// `workspace:1.2.3` is the pinned, sanctioned form and returns false.
export function isWorkspaceRangeSpec(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('workspace:')) {
    return false
  }
  return !EXACT_VERSION.test(value.slice('workspace:'.length))
}

// Whether a spec is a floating REGISTRY range (`^1.2.3`, `~1`, `>=5.0.0`,
// `1 || 2`, `*`, `latest`). An exact version, `catalog:`, `workspace:`, a
// local path, an `npm:` alias, and a git/tarball URL all return false.
export function isRegistryRangeSpec(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  const trimmed = value.trim()
  for (let i = 0, { length } = NON_RANGE_PREFIXES; i < length; i += 1) {
    if (trimmed.startsWith(NON_RANGE_PREFIXES[i]!)) {
      return false
    }
  }
  if (EXACT_VERSION.test(trimmed)) {
    return false
  }
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') {
    return true
  }
  if (trimmed.includes('||') || trimmed.includes(' - ')) {
    return true
  }
  return /^[<>=^~]/.test(trimmed)
}

// Classify one spec, or return `undefined` when it satisfies the pin contract.
// `field` is the dependency block it came from, which is what exempts
// `peerDependencies` from the registry-range class.
export function classifyDependencySpec(
  field: string,
  value: unknown,
): DependencySpecKind | undefined {
  if (localPathProtocol(value) !== undefined) {
    return 'local-path'
  }
  if (typeof value === 'string' && value.startsWith('workspace:')) {
    return isWorkspaceRangeSpec(value) ? 'workspace-range' : 'workspace-pin'
  }
  if (field !== 'peerDependencies' && isRegistryRangeSpec(value)) {
    return 'registry-range'
  }
  return undefined
}

// Whether a finding of this kind fails the gate.
//
// `registry-range` ships reporting-only while the fleet's remaining bare
// ranges convert; the call sites are already wired, so enforcement is one
// return value away. `workspace-pin` is reporting-only PERMANENTLY — it is a
// legal pin, and a repo whose sibling is not published yet has nowhere else
// to go. Its report exists to surface the `catalog:` conversion backlog.
export function isBlockingSpecKind(kind: DependencySpecKind): boolean {
  return kind === 'local-path' || kind === 'workspace-range'
}

function walkOverrides(
  field: string,
  prefix: string,
  node: unknown,
  out: DependencySpecFinding[],
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return
  }
  const entries = Object.entries(node as Record<string, unknown>)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [key, value] = entries[i]!
    const name = prefix === '' ? key : `${prefix}.${key}`
    const kind = classifyDependencySpec(field, value)
    if (kind !== undefined) {
      out.push({ field, kind, name, value: value as string })
      continue
    }
    walkOverrides(field, name, value, out)
  }
}

// Collect every spec in a package.json's dependency surface that falls outside
// the pin contract. Pure over the file text so callers need no fixture tree;
// returns an empty list for unparseable JSON so both tiers fail open.
export function collectDependencySpecFindings(
  text: string,
): DependencySpecFinding[] {
  let pkg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') {
      return []
    }
    pkg = parsed as Record<string, unknown>
  } catch {
    return []
  }
  const out: DependencySpecFinding[] = []
  for (let i = 0, { length } = DEP_FIELDS; i < length; i += 1) {
    const field = DEP_FIELDS[i]!
    const deps = pkg[field]
    if (deps === null || typeof deps !== 'object') {
      continue
    }
    const entries = Object.entries(deps as Record<string, unknown>)
    for (let j = 0, entryCount = entries.length; j < entryCount; j += 1) {
      const [name, value] = entries[j]!
      const kind = classifyDependencySpec(field, value)
      if (kind !== undefined) {
        out.push({ field, kind, name, value: value as string })
      }
    }
  }
  for (let i = 0, { length } = OVERRIDE_FIELDS; i < length; i += 1) {
    const field = OVERRIDE_FIELDS[i]!
    walkOverrides(field, '', pkg[field], out)
  }
  const pnpmSection = pkg['pnpm']
  if (pnpmSection !== null && typeof pnpmSection === 'object') {
    walkOverrides(
      'pnpm.overrides',
      '',
      (pnpmSection as Record<string, unknown>)['overrides'],
      out,
    )
  }
  return out
}

// A stable identity for a finding, so an edit-time caller can diff
// before-vs-after and report only what the edit introduces.
export function dependencySpecFindingKey(
  finding: DependencySpecFinding,
): string {
  return `${finding.field}.${finding.name}`
}
