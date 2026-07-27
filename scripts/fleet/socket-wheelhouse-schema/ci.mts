/*
 * @file CI + integration + workspace opt-ins of the socket-wheelhouse config:
 *   GitHub Actions workflows, Claude Code agents/skills, pnpm-workspace.yaml
 *   derived settings, and GitHub-related fleet config.
 */

import { Type } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// Workflows block — GitHub Actions opt-ins.
// ---------------------------------------------------------------------------

export const WorkflowsSchema = Type.Object(
  {
    ci: Type.Optional(
      Type.Boolean({ description: 'Ship `.github/workflows/ci.yml`.' }),
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
// Claude Code block — opt-in agents/skills/commands.
// ---------------------------------------------------------------------------

export const ClaudeSchema = Type.Object(
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

export const WorkspaceSchema = Type.Object(
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

export const GithubSchema = Type.Object(
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
