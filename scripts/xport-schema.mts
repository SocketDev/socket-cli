/**
 * @fileoverview TypeBox schema for xport.json — single source of truth.
 *
 * Everything else is derived:
 *   - TypeScript types in scripts/xport.mts via `Static<typeof ...>`
 *   - xport.schema.json (draft 2020-12) via direct JSON.stringify of the
 *     TypeBox schema, emitted by scripts/xport-emit-schema.mts
 *   - Runtime validation at harness startup via
 *     `validateSchema(XportManifestSchema, ...)` from
 *     `@socketsecurity/lib/validation/validate-schema`
 *
 * Byte-identical across socket-tui / socket-btm / socket-sdxgen / ultrathink /
 * socket-registry / socket-repo-template via sync-scaffolding.mts.
 */

import { Type, type Static } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Shared primitives.
// ---------------------------------------------------------------------------

const IdSchema = Type.String({
  pattern: '^[a-z0-9][A-Za-z0-9-]*$',
  description:
    'Stable identifier, unique within the manifest. Starts with lowercase letter or digit; remaining characters are letters/digits/hyphens. Kebab-case preferred, but camelCase segments are allowed (e.g. `export-findNodeAt` when the id mirrors an API name).',
})

const CriticalitySchema = Type.Integer({
  minimum: 1,
  maximum: 10,
  description:
    'Stay-in-step importance (1 = cosmetic, 10 = security-sensitive). Harness surfaces high-criticality drift louder.',
})

const UpstreamRefSchema = Type.String({
  description: 'Key into the top-level `upstreams` map.',
})

const ConformanceTestSchema = Type.String({
  description:
    "Path to a test that enforces behavior parity (modulo documented deviations). Strongly recommended — static checks can't catch silent behavioral drift.",
})

const NotesSchema = Type.String({
  description:
    'Free-form context — why this row exists, what gotchas to watch for.',
})

const PortStatusSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('implemented'), Type.Literal('opt-out')]),
    reason: Type.Optional(
      Type.String({
        description: 'Required when status is `opt-out`. Explain why.',
      }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Optional path to the port's implementation of this row. Useful for module-inventory rows where each language points at a different directory.",
      }),
    ),
    note: Type.Optional(
      Type.String({
        description:
          "Optional free-form note attached to a specific port's status.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Per-port status for a lang-parity row. `implemented` = port meets assertions; `opt-out` = port consciously skips, requires non-empty `reason`.',
  },
)

const UpstreamSchema = Type.Object(
  {
    submodule: Type.String({
      description: 'Submodule path, relative to repo root.',
    }),
    repo: Type.String({
      pattern: '^https?://',
      description: 'Upstream repository URL (http:// or https://).',
    }),
  },
  { additionalProperties: false },
)

const SiteSchema = Type.Object(
  {
    path: Type.String({
      description: "Path to the port's root directory, relative to repo root.",
    }),
    language: Type.Optional(
      Type.String({ description: 'Language label, for human reports.' }),
    ),
  },
  { additionalProperties: false },
)

const FixtureCheckSchema = Type.Object(
  {
    fixture_path: Type.String(),
    snapshot_path: Type.Optional(Type.String()),
    diff_tolerance: Type.Optional(
      Type.Union([
        Type.Literal('exact'),
        Type.Literal('line-by-line'),
        Type.Literal('semantic'),
      ]),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Golden-input verification. Prefer snapshot-based diffs over hardcoded counts (brittleness lesson from sdxgen's lock-step-features).",
  },
)

// ---------------------------------------------------------------------------
// Row kinds.
// ---------------------------------------------------------------------------

const FileForkRowSchema = Type.Object(
  {
    kind: Type.Literal('file-fork'),
    id: IdSchema,
    upstream: UpstreamRefSchema,
    criticality: Type.Optional(CriticalitySchema),
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    local: Type.String({
      description: 'Path to our ported file, relative to repo root.',
    }),
    upstream_path: Type.String({
      description: 'Path to the source file within the upstream submodule.',
    }),
    forked_at_sha: Type.String({
      pattern: '^[0-9a-f]{40}$',
      description:
        'Full 40-char SHA of the upstream commit we forked from. Harness runs `git log <sha>..HEAD -- <upstream_path>` to surface drift.',
    }),
    deviations: Type.Array(Type.String(), {
      minItems: 1,
      description:
        "Human-readable list of intentional differences. Zero deviations = use upstream directly; don't fork.",
    }),
  },
  {
    additionalProperties: false,
    description:
      'A local file derived from an upstream file with intentional modifications. Drift = upstream moved forward without us.',
  },
)

const VersionPinRowSchema = Type.Object(
  {
    kind: Type.Literal('version-pin'),
    id: IdSchema,
    upstream: UpstreamRefSchema,
    criticality: Type.Optional(CriticalitySchema),
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    pinned_sha: Type.String({
      pattern: '^[0-9a-f]{40}$',
      description: 'Full 40-char SHA the submodule is pinned to.',
    }),
    pinned_tag: Type.Optional(
      Type.String({
        description:
          'Human-readable release tag (e.g., `v3.2.1`). Optional — the SHA is authoritative.',
      }),
    ),
    upgrade_policy: Type.Union(
      [
        Type.Literal('track-latest'),
        Type.Literal('major-gate'),
        Type.Literal('locked'),
      ],
      {
        description:
          'track-latest: any new release is actionable; major-gate: only major bumps require review; locked: explicit decision per upgrade.',
      },
    ),
  },
  {
    additionalProperties: false,
    description:
      "A submodule pinned to an upstream release. Drift = upstream cut a new release we haven't adopted.",
  },
)

const FeatureParityRowSchema = Type.Object(
  {
    kind: Type.Literal('feature-parity'),
    id: IdSchema,
    upstream: UpstreamRefSchema,
    criticality: CriticalitySchema,
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    local_area: Type.String({
      description:
        'Path to the local module/directory implementing the feature. Code pattern scan targets this directory (excluding test files).',
    }),
    test_area: Type.Optional(
      Type.String({
        description:
          'Optional path to the directory where tests for this feature live. When absent, the harness searches inside `local_area`.',
      }),
    ),
    code_patterns: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Regex patterns the local implementation must contain. Prefer anchored patterns (function signatures) over loose keywords to avoid comment false positives.',
      }),
    ),
    test_patterns: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Regex patterns the test suite must contain.',
      }),
    ),
    fixture_check: Type.Optional(FixtureCheckSchema),
  },
  {
    additionalProperties: false,
    description:
      'A behavioral feature reimplemented locally to match upstream behavior. Three-pillar validation: code patterns, test patterns, fixture snapshots.',
  },
)

const SpecConformanceRowSchema = Type.Object(
  {
    kind: Type.Literal('spec-conformance'),
    id: IdSchema,
    upstream: UpstreamRefSchema,
    criticality: Type.Optional(CriticalitySchema),
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    local_impl: Type.String(),
    spec_version: Type.String(),
    spec_path: Type.Optional(
      Type.String({
        description:
          'Path within the upstream submodule to the spec document, if applicable.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'A local reimplementation of an external specification. Drift = the spec was revised.',
  },
)

// Assertions are deliberately untyped — each matrix area defines its own
// assertion shapes. The harness ignores fields it doesn't recognize.
// Historical precedent: ultrathink's xlang-harness.mts treats this as
// `unknown[]`.
const AssertionSchema = Type.Record(Type.String(), Type.Unknown())

const LangParityRowSchema = Type.Object(
  {
    kind: Type.Literal('lang-parity'),
    id: IdSchema,
    name: Type.String(),
    description: Type.String(),
    category: Type.String({
      description:
        'Grouping tag. `rejected` is reserved for anti-patterns (every port must be opt-out; reintroduction exits 2).',
    }),
    criticality: Type.Optional(CriticalitySchema),
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    assertions: Type.Optional(
      Type.Array(AssertionSchema, {
        description:
          'Open-ended assertion list. Each has a `kind` string the harness dispatches on. Unknown kinds are skipped with a log line.',
      }),
    ),
    matrix_files: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'For inventory rows that index other xport-lang-*.json files. Paths relative to this manifest.',
      }),
    ),
    ports: Type.Record(Type.String(), PortStatusSchema, {
      description: 'Per-site status. Keys must match top-level `sites`.',
    }),
  },
  {
    additionalProperties: false,
    description:
      'N sibling language ports of one spec within a single project. Drift = one port diverged from its siblings.',
  },
)

export const RowSchema = Type.Union([
  FileForkRowSchema,
  VersionPinRowSchema,
  FeatureParityRowSchema,
  SpecConformanceRowSchema,
  LangParityRowSchema,
])

// ---------------------------------------------------------------------------
// Top-level manifest.
// ---------------------------------------------------------------------------

export const XportManifestSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    area: Type.Optional(
      Type.String({
        description:
          "Optional label for this manifest file. Used as a grouping key in harness output. Defaults to 'root' for the top-level file and to the filename stem for included files.",
      }),
    ),
    includes: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Relative paths to sub-manifests. Top-level `upstreams` and `sites` maps override any same-keyed entries in included manifests.',
      }),
    ),
    upstreams: Type.Optional(
      Type.Record(Type.String(), UpstreamSchema, {
        description:
          'Named upstream submodules. Referenced by rows[].upstream on file-fork, version-pin, feature-parity, spec-conformance rows. Omit when the manifest only has lang-parity rows.',
      }),
    ),
    sites: Type.Optional(
      Type.Record(Type.String(), SiteSchema, {
        description:
          'Named sibling ports (typically per-language). Referenced by rows[].ports.<site> on lang-parity rows. Omit when the manifest has no lang-parity rows.',
      }),
    ),
    rows: Type.Array(RowSchema),
  },
  {
    description:
      'Unified lock-step manifest shared across Socket repos. One schema, all cases — `kind` discriminator on each row selects which flavor of lock-step applies.',
  },
)

export type Row = Static<typeof RowSchema>
export type XportManifest = Static<typeof XportManifestSchema>
export type Upstream = Static<typeof UpstreamSchema>
export type Site = Static<typeof SiteSchema>
export type PortStatus = Static<typeof PortStatusSchema>
export type FileForkRow = Static<typeof FileForkRowSchema>
export type VersionPinRow = Static<typeof VersionPinRowSchema>
export type FeatureParityRow = Static<typeof FeatureParityRowSchema>
export type SpecConformanceRow = Static<typeof SpecConformanceRowSchema>
export type LangParityRow = Static<typeof LangParityRowSchema>
