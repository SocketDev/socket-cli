/*
 * @file TypeBox schema for the per-fleet-repo socket-wheelhouse config consumed
 *   by `sync-scaffolding`. The config lives at
 *   `.config/repo/socket-wheelhouse.json` (the segregated member surface —
 *   see `findSocketWheelhouseConfig` in `paths.mts`). Each fleet repo
 *   (socket-lib, socket-cli, ultrathink, …) ships this config declaring its
 *   `layout` + `native` axes plus any per-repo opt-ins. The runner reads it to
 *   decide which optional files the repo is expected to ship and which it must
 *   not ship. Source-of-truth flow:
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

import { Type } from 'typebox'

import {
  BuildSchema,
  RepoSchema,
  SecondarySchema,
} from './socket-wheelhouse-schema/build.mts'
import { CapabilitiesSchema } from './socket-wheelhouse-schema/capabilities.mts'
import {
  ClaudeSchema,
  GithubSchema,
  WorkflowsSchema,
  WorkspaceSchema,
} from './socket-wheelhouse-schema/ci.mts'
import { DesignSchema } from './socket-wheelhouse-schema/design.mts'
import { DockerSchema } from './socket-wheelhouse-schema/docker.mts'
import { DocsSchema } from './socket-wheelhouse-schema/docs.mts'
import { NapiSchema } from './socket-wheelhouse-schema/napi.mts'
import {
  PathsAllowlistEntrySchema,
  ReleaseSchema,
} from './socket-wheelhouse-schema/policy.mts'
import {
  CoverageSchema,
  CoverSchema,
  VitestSchema,
} from './socket-wheelhouse-schema/testing.mts'
import {
  AiSchema,
  HooksSchema,
  LintSchema,
  LockstepSchema,
  ScriptsSchema,
  ViteSchema,
} from './socket-wheelhouse-schema/tooling.mts'

import type { Static } from 'typebox'

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
    ai: Type.Optional(AiSchema),
    capabilities: Type.Optional(CapabilitiesSchema),
    claude: Type.Optional(ClaudeSchema),
    cover: Type.Optional(CoverSchema),
    coverage: Type.Optional(CoverageSchema),
    design: Type.Optional(DesignSchema),
    docker: Type.Optional(DockerSchema),
    docs: Type.Optional(DocsSchema),
    github: Type.Optional(GithubSchema),
    hooks: Type.Optional(HooksSchema),
    lint: Type.Optional(LintSchema),
    lockstep: Type.Optional(LockstepSchema),
    napi: Type.Optional(NapiSchema),
    pathsAllowlist: Type.Optional(
      Type.Array(PathsAllowlistEntrySchema, {
        description:
          'Exemptions for the path-hygiene gate (scripts/fleet/check/paths-are-canonical.mts). Each entry needs a `reason`; prefer narrow entries (rule + file + snippet_hash + pattern) over blanket file-level exempts.',
      }),
    ),
    release: Type.Optional(ReleaseSchema),
    scripts: Type.Optional(ScriptsSchema),
    vite: Type.Optional(ViteSchema),
    vitest: Type.Optional(VitestSchema),
    workflows: Type.Optional(WorkflowsSchema),
    workspace: Type.Optional(WorkspaceSchema),
  },
  {
    description:
      'Per-repo socket-wheelhouse config, at `.config/repo/socket-wheelhouse.json` (the segregated member surface).',
  },
)

export type SocketWheelhouseConfig = Static<typeof SocketWheelhouseConfigSchema>
export type Capabilities = Static<typeof CapabilitiesSchema>
export type Repo = Static<typeof RepoSchema>
export type BuildConfig = Static<typeof BuildSchema>
export type Secondary = Static<typeof SecondarySchema>
export type Vite = Static<typeof ViteSchema>
export type Vitest = Static<typeof VitestSchema>
export type Coverage = Static<typeof CoverageSchema>
