/**
 * @fileoverview TypeBox schema for lockstep.json — single source of truth.
 *
 * Everything else is derived:
 *   - TypeScript types in scripts/lockstep/cli.mts via `Static<typeof ...>`
 *   - lockstep.schema.json (draft 2020-12) via direct JSON.stringify of the
 *     TypeBox schema, emitted by scripts/lockstep/emit-schema.mts
 *   - Runtime validation at harness startup via
 *     `validateSchema(LockstepManifestSchema, ...)` from
 *     `@socketsecurity/lib-stable/validation/validate-schema`
 *
 * Byte-identical across sdxgen / socket-btm / socket-registry /
 * socket-wheelhouse / stuie / ultrathink via sync-scaffolding.mts.
 */

import { Type, type Static } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Shared primitives.
// ---------------------------------------------------------------------------

// Full git commit SHA. Used by file-fork.forked_at_sha and
// version-pin.pinned_sha. Centralized so adding a new SHA-bearing
// field can't accidentally accept short SHAs.
const FULL_SHA_PATTERN = '^[0-9a-f]{40}$'

const IdSchema = Type.String({
  // Kebab-case enforced. The earlier "camelCase segments allowed for
  // API-mirror ids" relaxation produced inconsistent ids across
  // manifests. When an id needs to mirror an API name, namespace it:
  // `api/findNodeAt` instead of `export-findNodeAt`. The slash carves
  // out the camelCase segment without polluting top-level ids.
  pattern: '^[a-z0-9][a-z0-9-]*(/[A-Za-z0-9_-]+)?$',
  description:
    'Stable identifier, unique within the manifest. Kebab-case (lowercase letters / digits / hyphens). For ids that mirror an external API name, use a namespace prefix: `api/findNodeAt`, `node/parseURL`. The slash separates the kebab namespace from the free-form leaf.',
})

const CriticalitySchema = Type.Integer({
  minimum: 1,
  maximum: 10,
  description:
    'Stay-in-step importance. Anchors: 1 = cosmetic / nice-to-have; 5 = behavioral parity expected; 10 = security-sensitive. The harness surfaces high-criticality drift louder and gates feature-parity rows on the criticality/10 floor.',
})

const UpstreamRefSchema = Type.String({
  description:
    'Key into the top-level `upstreams` map. The harness errors if no matching upstream entry exists.',
})

const ConformanceTestSchema = Type.String({
  description:
    'Path (relative to repo root) of a test that enforces behavior parity (modulo documented deviations). Strongly recommended — static checks catch syntactic drift, not behavioral. A row without a conformance test relies entirely on code-pattern / fixture-snapshot checks.',
})

const NotesSchema = Type.String({
  description:
    'Free-form context: why this row exists, gotchas, links to related issues / PRs / upstream discussions. Read by humans, not by the harness.',
})

const PortStatusSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('implemented'), Type.Literal('opt-out')], {
      description:
        "`implemented` = port meets the row's assertions; `opt-out` = port consciously skips this row (requires `reason`).",
    }),
    reason: Type.Optional(
      Type.String({
        description:
          'Why this port opts out. SCHEMA-CONDITIONAL: required when status is `opt-out`. The TypeBox type cannot express the conditional, but the harness rejects opt-out rows with empty / missing reason.',
      }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Optional path to this port's implementation of the row. Useful for module-inventory rows where each language points at a different directory; redundant when the port's overall layout already encodes the path.",
      }),
    ),
    note: Type.Optional(
      Type.String({
        description:
          "Optional free-form note attached to this specific port's status. For multi-port context, prefer the row-level `notes` field.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Per-port status for a lang-parity row. The `ports` map on a row pairs each top-level `sites` key with one of these.',
  },
)

const UpstreamSchema = Type.Object(
  {
    submodule: Type.String({
      description:
        'Submodule path, relative to repo root. Must match an entry in `.gitmodules`.',
    }),
    repo: Type.String({
      // Tightened from `^https?://` to require a host. Empty hosts
      // (`http://`) silently match the loose pattern but break every
      // git operation downstream.
      pattern: '^https?://[^/\\s]+',
      description:
        'Upstream repository URL (http:// or https:// + host). Anchored at the host so empty URLs fail validation rather than failing at git-fetch time.',
    }),
  },
  {
    additionalProperties: false,
    description:
      'A submodule + its upstream repo URL. Referenced by file-fork / version-pin / feature-parity / spec-conformance rows via `upstream`.',
  },
)

const SiteSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to the port's root directory, relative to repo root. The harness reads files under this path when checking the port's assertions.",
    }),
    language: Type.Optional(
      Type.String({
        description:
          "Language label for human reports (e.g. `cpp`, `go`, `rust`, `typescript`). The harness does no language-specific processing — it's purely informational.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'A sibling port (typically per-language). Referenced by lang-parity rows via `ports.<site-key>`.',
  },
)

const FixtureCheckSchema = Type.Object(
  {
    fixture_path: Type.String({
      description:
        'Path (relative to repo root) of the input fixture the local implementation runs against.',
    }),
    snapshot_path: Type.Optional(
      Type.String({
        description:
          "Path (relative to repo root) of the snapshot file the implementation's output is diffed against. When absent, the harness only checks that the fixture is processed without error — no output comparison.",
      }),
    ),
    diff_tolerance: Type.Optional(
      Type.Union(
        [
          Type.Literal('exact'),
          Type.Literal('line-by-line'),
          Type.Literal('semantic'),
        ],
        {
          description:
            'How the snapshot diff is computed. `exact` = byte-identical; the strictest check. `line-by-line` = per-line diff after normalizing line endings (CRLF / LF); tolerates trailing-newline drift. `semantic` = harness-defined deeper comparison (typically AST or normalized JSON for output that has equivalent representations); each row kind documents what `semantic` means in its context.',
        },
      ),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Golden-input verification. Snapshot-based diffs replace the brittle hardcoded-count checks the harness used historically (sdxgen's lock-step-features lesson).",
  },
)

// ---------------------------------------------------------------------------
// Row kinds.
//
// Five kinds, each tracking a different "stay in sync with X" relation:
//
//   file-fork         — vendored file derived from upstream
//   version-pin       — submodule pinned to upstream release
//   feature-parity    — local impl mirrors upstream behavior
//   spec-conformance  — local impl of an external spec
//   lang-parity       — N sibling language ports of one spec
//
// The `kind` literal on each row is the harness's dispatch key. Adding
// a new kind = (1) new row schema here, (2) new case in lockstep.mts'
// dispatcher, (3) new report-row type. The schema keeps row kinds
// closed (no Type.Union with `any`); harness errors on unknown kinds
// rather than silently skipping.
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
      description:
        'Path (relative to repo root) of our ported copy of the upstream file.',
    }),
    upstream_path: Type.String({
      description:
        'Path within the upstream submodule (relative to the submodule root) of the source file we forked from.',
    }),
    forked_at_sha: Type.String({
      pattern: FULL_SHA_PATTERN,
      description:
        'Full 40-char SHA of the upstream commit we forked from. The harness runs `git log <sha>..HEAD -- <upstream_path>` inside the submodule to surface drift.',
    }),
    deviations: Type.Array(Type.String(), {
      minItems: 1,
      description:
        'Human-readable list of intentional differences from upstream. Zero deviations = the file should not be forked; consume upstream directly. Each entry is one short sentence (e.g. `swap require() for import` or `remove Node 14 fallback`).',
    }),
  },
  {
    additionalProperties: false,
    description:
      'A local file derived from an upstream file with intentional modifications. Drift = upstream moved forward on this path; we may need to cherry-pick or update our deviations.',
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
      pattern: FULL_SHA_PATTERN,
      description:
        'Full 40-char SHA the submodule is pinned to. Authoritative — the harness compares this against the submodule HEAD, not against `pinned_tag`.',
    }),
    pinned_tag: Type.Optional(
      Type.String({
        description:
          'Human-readable release tag for reports / PR titles (e.g. `v3.2.1`). Informational only — `pinned_sha` is the source of truth. Useful when an upstream cuts a release without changing semver but moves the SHA.',
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
          '`track-latest` = any new release is actionable; updating-lockstep auto-bumps. `major-gate` = patch / minor auto-bump; major bumps surfaced as advisory. `locked` = explicit decision per upgrade; the harness reports drift but never auto-bumps. Pick `locked` when bumping is gated on a coordinated change in another repo (e.g. Node vendoring temporal-rs).',
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
        'Path (relative to repo root) of the local module / directory implementing the feature. The code-pattern scan targets this directory recursively, excluding test files (matched by `*.test.{ts,mts,js,mjs}` and `*.spec.*`).',
    }),
    test_area: Type.Optional(
      Type.String({
        description:
          'Path (relative to repo root) of the directory where tests for this feature live. When absent, the harness searches for tests inside `local_area`. Useful when tests live in a sibling directory (e.g. `local_area=src/auth`, `test_area=test/auth`).',
      }),
    ),
    code_patterns: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Regex patterns the local implementation must contain. Prefer anchored patterns (function signatures, exported symbols) over loose keywords to avoid matching comments. Each pattern is searched independently across `local_area`; missing patterns lower the code score.',
      }),
    ),
    test_patterns: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Regex patterns the test suite must contain. Same scoring as `code_patterns` but searched across `test_area` (or `local_area` when `test_area` is absent).',
      }),
    ),
    fixture_check: Type.Optional(FixtureCheckSchema),
  },
  {
    additionalProperties: false,
    description:
      'A behavioral feature reimplemented locally to match upstream behavior. Three-pillar validation: code patterns + test patterns + fixture snapshot. The total score is averaged across present pillars; rows below the criticality / 10 floor surface as drift.',
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
    local_impl: Type.String({
      description:
        'Path (relative to repo root) of our reimplementation of the spec. Either a file or a directory.',
    }),
    spec_version: Type.String({
      description:
        'Version label of the spec we conform to (e.g. `ECMAScript-2024`, `RFC-9110`, commit SHA, or upstream tag). Free-form — the harness only checks for drift via the upstream submodule, not the version string itself.',
    }),
    spec_path: Type.Optional(
      Type.String({
        description:
          'Path within the upstream submodule to the spec document. Used to scope drift detection to the spec file (rather than every change in the upstream repo).',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'A local reimplementation of an external specification. Drift = the spec was revised; we may need to update our impl, the spec_version, or both.',
  },
)

// Open-ended assertion shape — each lang-parity row attaches whatever
// shape its harness needs.
//
// Each assertion is a `{ kind: string, ... }` object: the harness reads
// `kind` and dispatches to a per-kind checker. Known kinds (subject to
// per-repo extension):
//
//   `presence`     — `{kind: 'presence', symbol: string}`
//   `signature`    — `{kind: 'signature', signature: string, where?: string}`
//   `not-present`  — `{kind: 'not-present', anti_pattern: string, where?: string}`
//
// Repos add new kinds in their own harness extensions. Unknown kinds
// are skipped with a log line — schema-level enumeration would couple
// the manifest to one harness's dispatch table. Historical precedent:
// ultrathink/acorn/scripts/xlang-harness.mts.
const AssertionSchema = Type.Record(Type.String(), Type.Unknown(), {
  description:
    'A typed assertion the lang-parity row asserts on each port. Shape: `{kind: string, ...kind-specific fields}`. The lockstep harness dispatches on `kind`; per-kind contracts are documented in the harness, not here.',
})

const LangParityRowSchema = Type.Object(
  {
    kind: Type.Literal('lang-parity'),
    id: IdSchema,
    name: Type.String({
      description:
        'Short human-readable label for this row (e.g. `Range parsing`, `Async iterators`). Used in report headers; not parsed.',
    }),
    description: Type.String({
      description:
        'One-paragraph description of what behavior this row asserts on each port. Read by humans; not parsed.',
    }),
    category: Type.String({
      description:
        "Grouping tag for report aggregation (e.g. `parser`, `runtime`, `api`). The single magic value is `rejected` — RESERVED for anti-patterns: every port MUST be `opt-out`, and any port flipping to `implemented` exits 2 ('rejected anti-pattern reintroduced'). Use freely otherwise.",
    }),
    criticality: Type.Optional(CriticalitySchema),
    conformance_test: Type.Optional(ConformanceTestSchema),
    notes: Type.Optional(NotesSchema),
    assertions: Type.Optional(
      Type.Array(AssertionSchema, {
        description:
          'Assertions checked against each port. Each entry is `{kind: string, ...}`; the harness dispatches on `kind`. See AssertionSchema description for known kinds; unknown kinds skip with a log line. Mutually compatible with `matrix_files` (a row can have both, neither, or one).',
      }),
    ),
    matrix_files: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Paths (relative to this manifest) of `lockstep-lang-*.json` sub-manifests this row indexes. For inventory-style rows that group many smaller checks under one parent. The harness loads each and merges its rows.',
      }),
    ),
    ports: Type.Record(Type.String(), PortStatusSchema, {
      description:
        "Per-port status map. Keys MUST match top-level `sites` keys exactly — the harness errors on stray ports / missing sites. Each value is `{status: 'implemented' | 'opt-out', ...}` per PortStatusSchema.",
    }),
  },
  {
    additionalProperties: false,
    description:
      'N sibling language ports of one spec within a single project. Drift = a port diverged from its siblings (one implemented, others opt-out without reason / or vice versa), or a `rejected` anti-pattern was reintroduced.',
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

export const LockstepManifestSchema = Type.Object(
  {
    $schema: Type.Optional(
      Type.String({
        description:
          'JSON Schema reference for editor autocompletion. Conventionally `./lockstep.schema.json` — both the manifest and its schema live side-by-side at repo root.',
      }),
    ),
    description: Type.Optional(
      Type.String({
        description:
          'Human-readable description of what this manifest tracks. Read by humans, not parsed. One short paragraph.',
      }),
    ),
    area: Type.Optional(
      Type.String({
        description:
          "Optional label for this manifest file. Used as a grouping key in harness output (per-area summaries). Defaults to 'root' for the top-level file and to the filename stem (with the `lockstep-` prefix stripped) for included files.",
      }),
    ),
    includes: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Relative paths to sub-manifests. The harness loads each and merges its rows into a single flattened view. Top-level `upstreams` and `sites` maps override any same-keyed entries from included manifests (top wins on conflict).',
      }),
    ),
    upstreams: Type.Optional(
      Type.Record(Type.String(), UpstreamSchema, {
        description:
          'Named upstream submodules. Each entry pairs a submodule path with its repo URL. Referenced by rows[].upstream on file-fork / version-pin / feature-parity / spec-conformance rows. Omit when the manifest only has lang-parity rows.',
      }),
    ),
    sites: Type.Optional(
      Type.Record(Type.String(), SiteSchema, {
        description:
          'Named sibling ports (typically per-language: `cpp`, `go`, `rust`, `typescript`). Referenced by rows[].ports.<site> on lang-parity rows. Omit when the manifest has no lang-parity rows.',
      }),
    ),
    rows: Type.Array(RowSchema, {
      description:
        "The actual checks the harness runs. Empty array is valid (and expected for repos that have no upstream relationships — e.g. socket-cli's empty rows).",
    }),
  },
  {
    description:
      'Unified lock-step manifest shared across Socket repos. One schema, all cases — the `kind` discriminator on each row selects which flavor of lock-step applies. Single-file manifests work for repos with one cohesive concern; the `includes[]` field carves a manifest into per-area files (e.g. lockstep-acorn.json + lockstep-build.json) when one repo tracks multiple independent concerns.',
  },
)

export type Row = Static<typeof RowSchema>
export type LockstepManifest = Static<typeof LockstepManifestSchema>
export type Upstream = Static<typeof UpstreamSchema>
export type Site = Static<typeof SiteSchema>
export type PortStatus = Static<typeof PortStatusSchema>
export type FileForkRow = Static<typeof FileForkRowSchema>
export type VersionPinRow = Static<typeof VersionPinRowSchema>
export type FeatureParityRow = Static<typeof FeatureParityRowSchema>
export type SpecConformanceRow = Static<typeof SpecConformanceRowSchema>
export type LangParityRow = Static<typeof LangParityRowSchema>
