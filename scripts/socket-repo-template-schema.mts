/**
 * @fileoverview TypeBox schema for the per-fleet-repo socket-repo-template
 * config consumed by `sync-scaffolding`. Two valid locations:
 * `.config/socket-repo-template.json` (primary) or
 * `.socket-repo-template.json` at the repo root (alternative). Both are
 * first-class — pick the location that fits your repo's convention.
 *
 * Each fleet repo (socket-lib, socket-cli, ultrathink, …) ships this
 * config declaring its `layout` + `native` axes plus any per-repo
 * opt-ins. The runner reads it to decide which optional files the
 * repo is expected to ship and which it must not ship.
 *
 * Source-of-truth flow:
 *   - This TypeBox source → `Static<typeof SocketRepoTemplateConfigSchema>`
 *     for typed reads in the runner.
 *   - `socket-repo-template-emit-schema.mts` writes
 *     `.config/socket-repo-template-schema.json` (draft 2020-12) next to
 *     the per-repo config.
 *   - The per-repo config references the JSON Schema via its `$schema`
 *     field for IDE autocompletion.
 *
 * Byte-identical across the fleet via sync-scaffolding's IDENTICAL_FILES.
 */

import { Type, type Static } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Two orthogonal axes describe a fleet repo:
//
//   layout  — package shape: single-package vs monorepo.
//   native  — native-binary supply-chain role: none / consumer /
//             producer / both.
//
// Per-language ports (e.g. ultrathink's cpp/go/rust/typescript ports
// of one spec) live in `lockstep.json` `lang-parity` rows, not here —
// the manifest is the source of truth for parity tracking.
// ---------------------------------------------------------------------------

const LayoutSchema = Type.Union(
  [Type.Literal('single-package'), Type.Literal('monorepo')],
  {
    description:
      'Package layout. `single-package` = one `package.json` at root, no `packages/`. `monorepo` = pnpm workspaces under `packages/`.',
  },
)

const NativeSchema = Type.Union(
  [
    Type.Literal('none'),
    Type.Literal('consumer'),
    Type.Literal('producer'),
    Type.Literal('both'),
  ],
  {
    description:
      'Native-binary supply-chain role. `none` = pure-npm publish path. `consumer` = pulls prebuilt binaries from a sibling producer. `producer` = ships native artifacts via GH releases. `both` = consumes one set, produces another. (Per-language ports live in `lockstep.json` `lang-parity` rows, not here.)',
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
          'Wire `.husky/pre-push` → `.git-hooks/pre-push.mts`. Mandatory security gate; default true.',
      }),
    ),
    enableCommitMsg: Type.Optional(
      Type.Boolean({
        description:
          'Wire `.husky/commit-msg` → `.git-hooks/commit-msg.mts`. Strips AI attribution; default true.',
      }),
    ),
    enablePreCommit: Type.Optional(
      Type.Boolean({
        description:
          'Wire `.husky/pre-commit` → `.git-hooks/pre-commit.mts`. Lint + secret scan on staged files; default true.',
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
          'Script names whose body is allowed to drift from the canonical form (e.g. socket-lib runs a richer test runner than the standard `node scripts/test.mts`). Each entry is the script name only.',
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
        description: 'Ship `.claude/skills/scanning-security/SKILL.md`.',
      }),
    ),
    includeSharedSkills: Type.Optional(
      Type.Boolean({
        description:
          'Ship `.claude/skills/_shared/*` — env-check, path-guard-rule, report-format, security-tools, verify-build.',
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
          'Soak window in minutes before installing freshly-published packages. Fleet default 10080 (= 7 days).',
      }),
    ),
    minimumReleaseAgeExclude: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Scopes / package patterns exempt from the soak window. Socket-owned scopes typically listed here.',
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
// Top-level config.
// ---------------------------------------------------------------------------

export const SocketRepoTemplateConfigSchema = Type.Object(
  {
    $schema: Type.Optional(
      Type.String({
        description:
          'JSON Schema reference for editor autocompletion. Conventionally `./socket-repo-template-schema.json` — both the config and its schema live side-by-side in `.config/`.',
      }),
    ),
    schemaVersion: Type.Literal(1, {
      description:
        'Schema version. Bump on breaking changes; readers gate on it.',
    }),
    repoName: Type.String({
      pattern: '^[a-z0-9][a-z0-9-]*$',
      description:
        'Canonical repo basename (e.g. `socket-lib`, `ultrathink`). Used for layout / native-independent exemptions like the oxlint `socket-lib` carve-out.',
    }),
    layout: LayoutSchema,
    native: NativeSchema,
    hooks: Type.Optional(HooksSchema),
    scripts: Type.Optional(ScriptsSchema),
    lint: Type.Optional(LintSchema),
    workflows: Type.Optional(WorkflowsSchema),
    claude: Type.Optional(ClaudeSchema),
    workspace: Type.Optional(WorkspaceSchema),
  },
  {
    description:
      "Per-repo socket-repo-template config. Two valid locations: `.config/socket-repo-template.json` (primary) or `.socket-repo-template.json` at the repo root (alternative). Both are first-class — pick the location that fits your repo's convention.",
  },
)

export type SocketRepoTemplateConfig = Static<
  typeof SocketRepoTemplateConfigSchema
>
export type Layout = Static<typeof LayoutSchema>
export type Native = Static<typeof NativeSchema>
