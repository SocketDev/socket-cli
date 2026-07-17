/*
 * @file TypeBox schema for the per-fleet-repo socket-wheelhouse config consumed
 *   by `sync-scaffolding`. Two valid locations:
 *   `.config/socket-wheelhouse.json` (primary) or `.socket-wheelhouse.json` at
 *   the repo root (alternative). Both are first-class — pick the location that
 *   fits your repo's convention. Each fleet repo (socket-lib, socket-cli,
 *   ultrathink, …) ships this config declaring its `layout` + `native` axes
 *   plus any per-repo opt-ins. The runner reads it to decide which optional
 *   files the repo is expected to ship and which it must not ship.
 *   Source-of-truth flow:
 *
 *   - This TypeBox source → `Static<typeof SocketWheelhouseConfigSchema>` for
 *     typed reads in the runner.
 *   - `socket-wheelhouse-emit-schema.mts` writes
 *     `.config/socket-wheelhouse-schema.json` (draft 2020-12) next to the
 *     per-repo config.
 *   - The per-repo config references the JSON Schema via its `$schema` field for
 *     IDE autocompletion. Byte-identical across the fleet via
 *     sync-scaffolding's IDENTICAL_FILES.
 */

import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Two orthogonal axes describe a fleet repo:
//
//   layout  — package shape: solo vs mono.
//   native  — native-binary supply-chain role: none / consumer /
//             producer / both.
//
// Per-language ports (e.g. ultrathink's cpp/go/rust/typescript ports
// of one spec) live in `lockstep.json` `lang-parity` rows, not here —
// the manifest is the source of truth for parity tracking.
// ---------------------------------------------------------------------------

const RepoSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('solo'), Type.Literal('mono')], {
      description:
        'Package layout. `solo` = one `package.json` at root, no `packages/`. `mono` = pnpm workspaces under `packages/`.',
    }),
  },
  {
    description: 'Repo shape.',
    additionalProperties: false,
  },
)

// A publish channel's release source and artifact kind. Extracted so the
// primary `build` and each `secondaries[]` channel share the EXACT same enums.
const BuildFromSchema = Type.Union(
  [
    Type.Literal('npm-registry'),
    Type.Literal('github-release'),
    Type.Literal('crates-registry'),
    Type.Literal('go-registry'),
  ],
  {
    description:
      'Release source/target. `npm-registry` = published as an npm package. `github-release` = raw artifacts attached to a GitHub Release. `crates-registry` = published as a Rust crate to crates.io. `go-registry` = the Go module ecosystem — published by pushing a semver tag; proxy.golang.org fetches it, pkg.go.dev indexes it (no registry upload/token).',
  },
)

const BuildTypeSchema = Type.Union(
  [
    Type.Literal('js'),
    Type.Literal('addon'),
    Type.Literal('binary'),
    Type.Literal('rust'),
    Type.Literal('go'),
  ],
  {
    description:
      'Artifact kind. `js` = plain JS package. `addon` = `.node` native addon. `binary` = a native binary (executable or wasm module — wasm is a binary format, so it lives here, not its own value). `rust` = a native Rust crate (single crate or a Cargo workspace of crates) published to crates.io — no JS build. `go` = a native Go module with no JS build (symmetric to `rust`).',
  },
)

const BuildSchema = Type.Object(
  {
    from: BuildFromSchema,
    type: BuildTypeSchema,
  },
  {
    description:
      'How the repo is built + released. Drives the release-checksums file cascade + CI breadth. `from: github-release` repos are native producers (socket-btm); `from: npm-registry` + non-`js` type wrap prebuilt native bits (socket-bin/socket-addon); `type: js` is a plain package; `from: crates-registry` + `type: rust` is a native Rust crate (crates.io provides integrity, so no release-checksums cascade).',
    additionalProperties: false,
  },
)

// A secondary publish channel — same `{ from, type }` shape as the primary
// `build`, using the identical enums.
const SecondarySchema = Type.Object(
  {
    from: BuildFromSchema,
    type: BuildTypeSchema,
  },
  {
    description:
      'An additional publish channel beyond the primary `build`, e.g. `{from:npm-registry, type:addon}` for a `.node` addon shipped alongside a Rust crate.',
    additionalProperties: false,
  },
)

// ---------------------------------------------------------------------------
// Hooks block — git hook variant selection.
// ---------------------------------------------------------------------------

const HooksSchema = Type.Object(
  {
    enablePrePush: Type.Optional(
      Type.Boolean({
        description:
          'Wire `.git-hooks/pre-push` (shell shim) → `.git-hooks/pre-push.mts`. Mandatory security gate; default true.',
      }),
    ),
    enableCommitMsg: Type.Optional(
      Type.Boolean({
        description:
          'Wire `.git-hooks/commit-msg` (shell shim) → `.git-hooks/commit-msg.mts`. Strips AI attribution; default true.',
      }),
    ),
    enablePreCommit: Type.Optional(
      Type.Boolean({
        description:
          'Wire `.git-hooks/pre-commit` (shell shim) → `.git-hooks/pre-commit.mts`. Lint + secret scan on staged files; default true.',
      }),
    ),
    preCommitVariant: Type.Optional(
      Type.Union([Type.Literal('lint-only'), Type.Literal('lint-test')], {
        description:
          '`lint-only` runs format + secret scan; `lint-test` adds vitest on touched packages. Default `lint-test`.',
      }),
    ),
  },
  { description: 'Git-hook opt-ins.' },
)

// ---------------------------------------------------------------------------
// Scripts block — package.json script declarations.
// ---------------------------------------------------------------------------

const ScriptsSchema = Type.Object(
  {
    required: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Override REQUIRED_SCRIPTS from manifest.mts. Usually omitted — the fleet default applies.',
      }),
    ),
    optional: Type.Optional(
      Type.Record(Type.String(), Type.Boolean(), {
        description:
          'Per-script opt-in map keyed by script name. `true` = repo ships this RECOMMENDED script; `false` = explicit opt-out.',
      }),
    ),
    bodyExempt: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Script names whose body is allowed to drift from the canonical form (e.g. socket-lib runs a richer test runner than the standard `node scripts/fleet/test.mts`). Each entry is the script name only.',
      }),
    ),
  },
  { description: 'package.json script tracking overrides.' },
)

// ---------------------------------------------------------------------------
// Lint block — oxlint profile selection.
// ---------------------------------------------------------------------------

const LintSchema = Type.Object(
  {
    profile: Type.Optional(
      Type.Union([Type.Literal('standard'), Type.Literal('rich')], {
        description:
          '`standard` requires the fleet plugin set (import + typescript + unicorn). `rich` opts into a wider set; check the runner for the exact basenames currently exempted.',
      }),
    ),
  },
  { description: 'oxlint profile.' },
)

// ---------------------------------------------------------------------------
// Vitest block — test-suite tuning the canonical vitest config reads.
// ---------------------------------------------------------------------------

const VitestSchema = Type.Object(
  {
    conformanceExclude: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Heavy external-suite / cross-impl conformance wrapper globs excluded from the DEFAULT (unit) + cover suites, keeping the unit pass inside the fleet under-a-minute budget. A repo setting this MUST pair it with an explicit `test:conformance` runner so the tier never silently drops.',
      }),
    ),
    lanes: Type.Optional(
      Type.Object(
        {
          mid: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Globs for the `mid` lane — isolated in-process suites (env-mutating / vi.mock / fs-heavy). Skipped by the bare `pnpm test` fast lane; run via `pnpm run test:mid`. Coverage + CI run every lane, so nothing is cut.',
            }),
          ),
          slow: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Globs for the `slow` lane — heavy suites (subprocess-per-case, e.g. hook integration specs). Skipped by the bare `pnpm test` fast lane; run via `pnpm run test:slow`. Coverage + CI run every lane, so nothing is cut.',
            }),
          ),
        },
        {
          description:
            "Test LANES: a SPEED category orthogonal to test TYPE (unit/integration/e2e). `fast` is the implicit complement of `mid`+`slow`. The runner's `--lane <fast|mid|slow>` flag selects one; bare `pnpm test` defaults to `fast`.",
        },
      ),
    ),
    legacyScriptTests: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Repo-relative paths of legacy script-style test files (self-executing scripts, not vitest suites) excluded from every vitest tier. Each file keeps running through its own runner; listing it here keeps the tier configs from picking it up.',
      }),
    ),
    unitBudgetMs: Type.Optional(
      Type.Number({
        minimum: 1000,
        description:
          'Wall-clock budget for the unit test suites under cover.mts, in milliseconds. Fleet default 60000 (under a minute). A suite exceeding the budget gets a loud report-only warning pointing at the slow/mid lanes (`vitest.lanes`); the gate ratchets to a hard failure once the fleet conforms.',
      }),
    ),
  },
  {
    description:
      'Tuning for the canonical vitest config (.config/repo/vitest.config.mts).',
  },
)

// ---------------------------------------------------------------------------
// Workflows block — GitHub Actions opt-ins.
// ---------------------------------------------------------------------------

const WorkflowsSchema = Type.Object(
  {
    ci: Type.Optional(
      Type.Boolean({ description: 'Ship `.github/workflows/ci.yml`.' }),
    ),
    weeklyUpdate: Type.Optional(
      Type.Boolean({
        description: 'Ship `.github/workflows/weekly-update.yml`.',
      }),
    ),
    provenance: Type.Optional(
      Type.Boolean({
        description:
          'Repo publishes with npm provenance (OIDC). Hint for setup helpers; not enforced by the checker today.',
      }),
    ),
    requirePinnedFullSha: Type.Optional(
      Type.Boolean({
        description:
          'Enforce 40-char SHA pins on every `uses:` ref. Defaults to true; an opt-out is reserved for special cases (e.g. workflow-dispatch test rigs) and currently has no consumer.',
      }),
    ),
  },
  { description: 'CI workflow opt-ins.' },
)

// ---------------------------------------------------------------------------
// Claude block — opt-in agents/skills/commands.
// ---------------------------------------------------------------------------

const ClaudeSchema = Type.Object(
  {
    includeSecurityScanSkill: Type.Optional(
      Type.Boolean({
        description: 'Ship `.claude/skills/fleet/scanning-security/SKILL.md`.',
      }),
    ),
    includeSharedSkills: Type.Optional(
      Type.Boolean({
        description:
          'Ship `.claude/skills/fleet/_shared/*` — env-check, path-guard-rule, report-format, security-tools, verify-build.',
      }),
    ),
    includeUpdatingSkill: Type.Optional(
      Type.Boolean({
        description:
          'Ship the dependency-update skill. Reserved — no consumer wired today.',
      }),
    ),
  },
  { description: 'Claude Code opt-ins.' },
)

// ---------------------------------------------------------------------------
// Workspace block — pnpm-workspace.yaml derived settings.
// ---------------------------------------------------------------------------

const WorkspaceSchema = Type.Object(
  {
    allowBuilds: Type.Optional(
      Type.Record(Type.String(), Type.Boolean(), {
        description:
          'pnpm `onlyBuiltDependencies` allowlist. Map a package name to true/false to grant/deny build scripts.',
      }),
    ),
    blockExoticSubdeps: Type.Optional(
      Type.Boolean({
        description:
          'Refuse transitive git/tarball subdeps (direct git deps still allowed). Required true; the field exists so a repo can document the intent locally.',
      }),
    ),
    minimumReleaseAge: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          'Soak time in minutes before installing freshly-published packages. Fleet default 10080 (= 7 days).',
      }),
    ),
    minimumReleaseAgeExclude: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Scopes / package patterns exempt from the soak time. Socket-owned scopes typically listed here.',
      }),
    ),
    resolutionMode: Type.Optional(
      Type.Union([Type.Literal('highest'), Type.Literal('lowest-direct')], {
        description: 'pnpm `resolutionMode`. Fleet default `highest`.',
      }),
    ),
    trustPolicy: Type.Optional(
      Type.Union([Type.Literal('no-downgrade'), Type.Literal('match-spec')], {
        description: 'pnpm `trustPolicy`. Fleet default `no-downgrade`.',
      }),
    ),
  },
  {
    description:
      'pnpm-workspace.yaml setting hints. The runner reads from the YAML; this block exists for repos that prefer to declare intent in JSON.',
  },
)

// ---------------------------------------------------------------------------
// GitHub-related config. Lives in our own JSON file (not .github/*.yml)
// because the fleet rule is "JSON not YAML for configs we own."
// ---------------------------------------------------------------------------

const GithubSchema = Type.Object(
  {
    apps: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'GitHub App slugs that must be installed on the repo (e.g. `cursor`, `socket-security`, `socket-trufflehog`). Audited by `scripts/fleet/lint-github-settings.mts` — apps whose installation cannot be reliably detected via check-suites are trusted via this manifest.',
      }),
    ),
  },
  {
    description: 'GitHub-related fleet config.',
  },
)

// ---------------------------------------------------------------------------
// pathsAllowlist — exemptions for the path-hygiene gate
// (scripts/fleet/check/paths-are-canonical.mts). The sole allowlist source, per the
// "JSON not YAML for our own configs" rule.
// ---------------------------------------------------------------------------

const PathsAllowlistEntrySchema = Type.Object(
  {
    rule: Type.Optional(
      Type.String({
        description: 'Rule letter (A, B, C, D, F, G). Omit to match any rule.',
      }),
    ),
    file: Type.Optional(
      Type.String({
        description: 'Substring match against the relative file path.',
      }),
    ),
    pattern: Type.Optional(
      Type.String({
        description: 'Substring match against the offending snippet.',
      }),
    ),
    line: Type.Optional(
      Type.Number({
        description: 'Exact line number. Strict — no fuzz tolerance.',
      }),
    ),
    snippet_hash: Type.Optional(
      Type.String({
        description:
          "12-char SHA-256 prefix of the normalized snippet (whitespace collapsed). Drift-resistant: keeps matching after reformatting that doesn't change the offending construction. Get via `node scripts/fleet/check/paths-are-canonical.mts --show-hashes`.",
      }),
    ),
    reason: Type.String({
      description: 'Why this site is genuinely exempt. Required.',
    }),
  },
  {
    description: 'One exemption for the path-hygiene gate.',
  },
)

const ReleaseSchema = Type.Object(
  {
    versionPolicy: Type.Optional(
      Type.Union([Type.Literal('standard'), Type.Literal('patch-only')], {
        description:
          'Version-bump policy enforced by bump.mts. `standard` (default): derive major/minor/patch from Conventional Commits. `patch-only`: reject any major/minor bump — only the patch may increment (e.g. socket-wheelhouse stays 1.0.x).',
      }),
    ),
  },
  {
    additionalProperties: false,
    description: 'Release / version-bump policy.',
  },
)

// ---------------------------------------------------------------------------
// Design block — per-repo UI/asset design budgets (a repo opts in only if it
// ships UI assets). `contrast` is the WCAG color-contrast budget: each file
// names selector/background pairs a lint gate verifies clear a minimum ratio.
// ---------------------------------------------------------------------------

const ContrastCheckSchema = Type.Object(
  {
    selector: Type.String({
      description:
        'CSS selector (regex-escaped) whose foreground color is checked.',
    }),
    bg: Type.String({
      description: 'Background color (hex) the foreground is measured against.',
    }),
    minRatio: Type.Optional(
      Type.Number({
        description: 'Minimum contrast ratio. Defaults to 4.5 (WCAG AA).',
      }),
    ),
    label: Type.Optional(
      Type.String({ description: 'Human-readable label for the check.' }),
    ),
  },
  {
    additionalProperties: false,
    description: 'One foreground/background contrast pair to verify.',
  },
)

const ContrastFileSchema = Type.Object(
  {
    path: Type.String({
      description: 'Repo-relative path to the file whose colors are checked.',
    }),
    checks: Type.Array(ContrastCheckSchema, {
      description: 'The contrast pairs to verify in this file.',
    }),
  },
  {
    additionalProperties: false,
    description: 'A file and the set of contrast pairs to verify within it.',
  },
)

const ContrastSchema = Type.Object(
  {
    files: Type.Array(ContrastFileSchema, {
      description: 'Files with contrast pairs to verify.',
    }),
  },
  {
    additionalProperties: false,
    description: 'WCAG color-contrast budget for the repo.',
  },
)

const DesignSchema = Type.Object(
  {
    contrast: Type.Optional(ContrastSchema),
  },
  {
    additionalProperties: false,
    description:
      'Per-repo design budgets (opt-in; only repos shipping UI assets set this).',
  },
)

// ---------------------------------------------------------------------------
// Docker block — per-repo Docker infrastructure declared as data. `prebakes`
// is the layered base-image manifest (bases named by toolchain), driving the
// prebake build + the downstream `FROM` references.
// ---------------------------------------------------------------------------

const PrebakePinsGoSchema = Type.Object(
  {
    version: Type.String(),
    sha256: Type.Object(
      {
        amd64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
        arm64: Type.String({ pattern: '^[0-9a-f]{64}$' }),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    description: 'Go toolchain version + per-arch sha256.',
  },
)

const PrebakePinsSchema = Type.Object(
  {
    description: Type.Optional(Type.String()),
    ubuntuDigest: Type.Optional(
      Type.String({
        pattern: '^sha256:[0-9a-f]{64}$',
        description: 'Digest the ubuntu roots FROM, pinning the OS layer.',
      }),
    ),
    ubuntuTag: Type.Optional(
      Type.String({
        description: 'Human-readable ubuntu tag the digest corresponds to.',
      }),
    ),
    aptSnapshot: Type.Optional(
      Type.String({
        pattern: '^[0-9]{8}T[0-9]{6}Z$',
        description:
          'Snapshot timestamp (YYYYMMDDTHHMMSSZ) apt is pinned to, freezing transitive deps.',
      }),
    ),
    go: Type.Optional(PrebakePinsGoSchema),
    emsdkVersion: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
    description: 'Maximally-pinned build inputs injected as build-args.',
  },
)

const PrebakeEntrySchema = Type.Object(
  {
    name: Type.String({
      pattern: '^[a-z0-9][a-z0-9._/-]*$',
      description: 'Image name. Toolchain-named, not output-named.',
    }),
    status: Type.Union([Type.Literal('active'), Type.Literal('planned')], {
      description:
        '`active` = built + pushed today; `planned` = designed only.',
    }),
    from: Type.String({
      description:
        'Parent image: another prebake `name`, or an external `<image>:<tag>`.',
    }),
    vendorSource: Type.Optional(
      Type.String({
        description:
          'Upstream recipe this layer is built from when vendored rather than pulled.',
      }),
    ),
    dockerfile: Type.Optional(
      Type.String({
        pattern: '^docker/fleet-bases/[a-z0-9-]+\\.Dockerfile$',
        description: 'Repo-relative path to the Dockerfile that builds it.',
      }),
    ),
    installs: Type.Array(Type.String(), {
      description: 'Toolchains/packages this layer adds on top of `from`.',
    }),
    libc: Type.Optional(
      Type.Array(Type.Union([Type.Literal('glibc'), Type.Literal('musl')]), {
        description: 'libc variants built.',
      }),
    ),
    platforms: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Target platforms (Docker `os/arch`).',
      }),
    ),
    tagFrom: Type.Optional(
      Type.String({
        description: 'Source of the content hash deciding when to rebuild.',
      }),
    ),
    project: Type.Optional(
      Type.String({ description: 'Build-cache project id, if any.' }),
    ),
    consumers: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Repos / builders that FROM this base.',
      }),
    ),
    purpose: Type.String({
      minLength: 1,
      description: 'Why this layer exists and what lands on it.',
    }),
  },
  {
    additionalProperties: false,
    description: 'One prebaked base image.',
  },
)

const PrebakesSchema = Type.Object(
  {
    description: Type.Optional(Type.String()),
    registry: Type.String({
      description: 'Registry images are pushed to / pulled from.',
    }),
    pins: Type.Optional(PrebakePinsSchema),
    prebakes: Type.Array(PrebakeEntrySchema, {
      description: 'Each prebaked base image, ordered bottom-up.',
    }),
  },
  {
    additionalProperties: false,
    description: 'Layered prebaked base-image manifest.',
  },
)

const DockerSchema = Type.Object(
  {
    prebakes: Type.Optional(PrebakesSchema),
  },
  {
    additionalProperties: false,
    description:
      'Per-repo Docker infrastructure (opt-in; only repos maintaining base images set this).',
  },
)

// ---------------------------------------------------------------------------
// Top-level config.
// ---------------------------------------------------------------------------

export const SocketWheelhouseConfigSchema = Type.Object(
  {
    $schema: Type.Optional(
      Type.String({
        description:
          'JSON Schema reference for editor autocompletion. Conventionally `./socket-wheelhouse-schema.json` — both the config and its schema live side-by-side in `.config/`.',
      }),
    ),
    schemaVersion: Type.Literal(1, {
      description:
        'Schema version. Bump on breaking changes; readers gate on it.',
    }),
    repoName: Type.String({
      pattern: '^[a-z0-9][a-z0-9-]*$',
      description:
        'Canonical repo basename (e.g. `socket-lib`, `ultrathink`). Used for shape-independent exemptions like the oxlint `socket-lib` carve-out.',
    }),
    repo: RepoSchema,
    build: BuildSchema,
    secondaries: Type.Optional(
      Type.Array(SecondarySchema, {
        description:
          'Additional publish channels beyond the primary `build` — e.g. a Rust crate (crates-registry/rust) that also ships a `.node` addon to npm carries `{from:npm-registry, type:addon}`. Each channel gets its own publish workflow.',
      }),
    ),
    release: Type.Optional(ReleaseSchema),
    design: Type.Optional(DesignSchema),
    docker: Type.Optional(DockerSchema),
    hooks: Type.Optional(HooksSchema),
    scripts: Type.Optional(ScriptsSchema),
    lint: Type.Optional(LintSchema),
    vitest: Type.Optional(VitestSchema),
    workflows: Type.Optional(WorkflowsSchema),
    claude: Type.Optional(ClaudeSchema),
    workspace: Type.Optional(WorkspaceSchema),
    github: Type.Optional(GithubSchema),
    pathsAllowlist: Type.Optional(
      Type.Array(PathsAllowlistEntrySchema, {
        description:
          'Exemptions for the path-hygiene gate (scripts/fleet/check/paths-are-canonical.mts). Each entry needs a `reason`; prefer narrow entries (rule + file + snippet_hash + pattern) over blanket file-level exempts.',
      }),
    ),
  },
  {
    description:
      "Per-repo socket-wheelhouse config. Two valid locations: `.config/socket-wheelhouse.json` (primary) or `.socket-wheelhouse.json` at the repo root (alternative). Both are first-class — pick the location that fits your repo's convention.",
  },
)

export type SocketWheelhouseConfig = Static<typeof SocketWheelhouseConfigSchema>
export type Repo = Static<typeof RepoSchema>
export type Build = Static<typeof BuildSchema>
export type Secondary = Static<typeof SecondarySchema>
export type Vitest = Static<typeof VitestSchema>
