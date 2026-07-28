/*
 * @file Dev-tooling opt-ins of the socket-wheelhouse config: git-hook variant
 *   selection, package.json script tracking overrides, the oxlint profile, and
 *   the lock-step-ref-nudge hook's resolution config.
 */

import { Type } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// AI block — keyless local AI opt-ins.
// ---------------------------------------------------------------------------

export const AiSchema = Type.Object(
  {
    localAssist: Type.Optional(
      Type.Boolean({
        description:
          'Opt into keyless single-shot AI assists via the locai CLI from SocketDev/odai — on-device backends such as Gemini Nano through headless Chrome, a loopback llama-server, or the deterministic simulator; no ANTHROPIC_API_KEY involved. Summary-class tasks only, read by scripts/fleet/_shared/locai.mts consumers such as the land-work commit-body summarizer. Default false; when no locai backend resolves the assist is a clean skip, never a failure.',
      }),
    ),
  },
  { description: 'Keyless local AI opt-ins. Per-repo, default all-off.' },
)

// ---------------------------------------------------------------------------
// Hooks block — git hook variant selection.
// ---------------------------------------------------------------------------

export const HooksSchema = Type.Object(
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

export const ScriptsSchema = Type.Object(
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

export const LintSchema = Type.Object(
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

export const ViteSchema = Type.Object(
  {
    allowEsbuild: Type.Optional(
      Type.String({
        description:
          'Reasoned opt-out of the esbuild ban in vite-is-rolldown-native for a legitimate NON-BUNDLER esbuild use (e.g. an opt-in minify pass that dynamic-imports esbuild, a browser-bundle e2e arm). The vite<8 floor stays unconditional and the build bundler stays rolldown; this only tolerates esbuild as a declared test/dev dependency. The string is the why — name the consuming module(s).',
      }),
    ),
  },
  {
    description:
      'vite/rolldown posture knobs read by scripts/fleet/check/vite-is-rolldown-native.mts.',
  },
)

// ---------------------------------------------------------------------------
// Opt-in config the `lock-step-ref-nudge` hook reads to resolve
// `with/from <Lang>: <path>` code-comment refs. Kept in ONE member-owned
// config surface per the `no-new-config-guard`.
// ---------------------------------------------------------------------------

export const LockstepSchema = Type.Object(
  {
    roots: Type.Optional(
      Type.Record(Type.String(), Type.Array(Type.String()), {
        description:
          'Per-language impl roots the hook resolves `Lock-step with <Lang>: <path>` refs against, most-preferred first. Keys are the `<Lang>` tokens used in comments (`Rust`, `C++`, `TS`, …); values are repo-relative candidate dirs.',
      }),
    ),
    scan: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Directories the lock-step comment scanner walks for `Lock-step` refs.',
      }),
    ),
    extensions: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Source-file extensions (leading dot) the comment scanner considers.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Opt-in config for the `lock-step-ref-nudge` hook — validates `Lock-step with/from <Lang>: <path>` code comments against real impl paths. Absent = malformed-shape checks only (stale-path checks off).',
  },
)
