/**
 * @file Canonical TypeBox schema for the fleet's external-tools data files.
 *   Every tool-data file across the fleet uses one container shape — `{ tools:
 *   { <name>: ToolEntry } }`:
 *
 *   - build/release tools — `external-tools.json` at repo root,
 *   - security-hook tools —
 *     `.claude/hooks/fleet/setup-security-tools/external-tools.json`,
 *   - CLI-VFS-bundled tools — `packages/cli/bundle-tools.json`. They share one
 *     field vocabulary (`ToolEntry`). The `bundled` flag marks a tool embedded
 *     into a built artifact (the CLI VFS), so "is this bundled?" is a data
 *     property rather than "which file is it in?". Validate at every load
 *     boundary with `parseToolsConfig` so a shape drift (a renamed field, a
 *     wrong nesting, a missing version) fails at parse time with a path-listed
 *     message, instead of surfacing later as an undefined-at-runtime throw.
 */

import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'

import { parseSchema } from '@socketsecurity/lib-stable/schema/parse'
import { validateSchema } from '@socketsecurity/lib-stable/schema/validate'

// A package manager a tool is fetched/run through.
export const PackageManager = Type.Union([
  Type.Literal('npm'),
  Type.Literal('pip'),
  Type.Literal('pnpm'),
])

// How a GitHub-hosted tool ships: a release asset, a source archive, or a
// pipx-installed git ref (security-hook tools).
export const ReleaseKind = Type.Union([
  Type.Literal('asset'),
  Type.Literal('archive'),
  Type.Literal('pipx-git'),
])

// One platform's downloadable artifact + its SRI integrity (sha256-…).
// `source`/`binary` cover the odd case where a platform installs from an npm
// tarball run through system Node rather than a native release asset (e.g.
// pnpm's darwin-x64, which upstream stopped shipping as a SEA binary): `source`
// names the registry the tarball is fetched from, `binary` the path to run
// inside it.
export const PlatformEntry = Type.Object(
  {
    asset: Type.String(),
    integrity: Type.String(),
    source: Type.Optional(Type.String()),
    binary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

// A dated soak-bypass: a freshly-published pin rides this until its 7-day
// minimumReleaseAge window clears. `version` is the pinned release, `published`
// the upstream release date, `removable` the date the soak clears (after which
// the bypass auto-disarms and this block should be dropped on the next bump).
// The bootstrap reads this to decide whether a just-cut release still needs the
// soak waived — so the dep version + its release date are tracked here.
export const SoakBypass = Type.Object(
  {
    version: Type.String(),
    published: Type.String(),
    removable: Type.String(),
  },
  { additionalProperties: false },
)

// An npm-package reference for a tool whose primary artifact is a binary but
// that also publishes an npm flavor (e.g. sfw).
export const NpmRef = Type.Object(
  {
    package: Type.Optional(Type.String()),
    version: Type.String(),
  },
  { additionalProperties: false },
)

// One checksum-map value. Either a bare hex sha256 (bundle-tools.json's
// filename → hash) or an `{ asset, sha256 }` object (external-tools.json's
// platform → artifact). Both shapes exist across the fleet.
export const ChecksumValue = Type.Union([
  Type.String(),
  Type.Object(
    {
      asset: Type.String(),
      sha256: Type.String(),
    },
    { additionalProperties: false },
  ),
])

// The shared per-tool entry. Every field is optional except where a consumer
// requires it at runtime; the union is the superset across all three files.
// `additionalProperties: false` makes an unmodeled key a hard error so drift is
// caught here rather than silently ignored.
export const ToolEntry = Type.Object(
  {
    description: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    // ISO date (YYYY-MM-DD) a pinned version was selected (security tools).
    versionDate: Type.Optional(Type.String()),
    // GitHub release tag when it differs from `version` (e.g. python).
    tag: Type.Optional(Type.String()),
    packageManager: Type.Optional(PackageManager),
    repository: Type.Optional(Type.String()),
    release: Type.Optional(ReleaseKind),
    // npm SRI (sha512-…) or single-artifact SRI (sha256-…).
    integrity: Type.Optional(Type.String()),
    // checksum map: key → hex sha256 (bundle-tools) or { asset, sha256 }
    // (external-tools per-platform). See ChecksumValue.
    checksums: Type.Optional(Type.Record(Type.String(), ChecksumValue)),
    // platform key → { asset, integrity } for per-platform binaries.
    platforms: Type.Optional(Type.Record(Type.String(), PlatformEntry)),
    npm: Type.Optional(NpmRef),
    // PackageURL (pkg:npm/name@version) for security-hook tools.
    purl: Type.Optional(Type.String()),
    // Package managers a firewall/sfw tool shims.
    ecosystems: Type.Optional(Type.Array(Type.String())),
    // Custom install directory (e.g. janus → wheelhouse).
    installDir: Type.Optional(Type.String()),
    // A dated soak-bypass for a freshly-published pin (see SoakBypass). The
    // bootstrap reads this to know whether a just-cut release still needs the
    // 7-day soak waived; it auto-disarms once `removable` passes.
    soakBypass: Type.Optional(SoakBypass),
    // The on-disk binary name a tool installs to, when it differs from the tool
    // id (e.g. sfw-free / sfw-enterprise both install a `sfw` binary).
    binaryName: Type.Optional(Type.String()),
    // Human-readable notes — a single line or a list.
    notes: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())]),
    ),
    // Marks a tool embedded into a built artifact (the CLI VFS).
    bundled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

// The single container shape every tool-data file uses:
// `{ $schema?, description?, extends?, tools: { <name>: ToolEntry } }`.
// Both external-tools.json (build/release + security-hook) and
// packages/cli/bundle-tools.json wrap their entries under `tools`; the
// `bundled` flag on an entry — not which file it lives in — marks a tool
// embedded into a built artifact.
export const ToolsConfig = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    // Path to a base external-tools.json this one inherits from.
    extends: Type.Optional(Type.String()),
    tools: Type.Record(Type.String(), ToolEntry),
  },
  { additionalProperties: false },
)

export type ToolEntryType = Static<typeof ToolEntry>
export type ToolsConfigType = Static<typeof ToolsConfig>

/**
 * Parse + validate a tool-data file (external-tools.json or bundle-tools.json).
 * Throws with a path-listed message on any shape violation.
 */
export function parseToolsConfig(data: unknown): ToolsConfigType {
  return parseSchema(ToolsConfig, data)
}

export interface ValidationFailure {
  readonly path: string
  readonly message: string
}

/**
 * Non-throwing validation against the given schema. Returns the list of issues
 * (empty when valid). Lets a caller (e.g. the fleet check) report every file's
 * problems without aborting on the first.
 */
export function collectIssues(
  schema: TSchema,
  data: unknown,
): ValidationFailure[] {
  const result = validateSchema(schema, data)
  if (result.ok) {
    return []
  }
  return result.errors.map(issue => ({
    // `path` is an array segment list (e.g. ['tools', 'sfw', 'version']);
    // render it as a dotted path for the report.
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }))
}
