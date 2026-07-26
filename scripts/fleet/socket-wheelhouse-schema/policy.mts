/*
 * @file Repo-policy blocks of the socket-wheelhouse config: path-hygiene gate
 *   exemptions and the release / version-bump policy.
 */

import { Type } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// pathsAllowlist — exemptions for the path-hygiene gate
// (scripts/fleet/check/paths-are-canonical.mts). The sole allowlist source, per the
// "JSON not YAML for our own configs" rule.
// ---------------------------------------------------------------------------

export const PathsAllowlistEntrySchema = Type.Object(
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

// ---------------------------------------------------------------------------
// Release block — release / version-bump policy enforced by bump.mts.
// ---------------------------------------------------------------------------

export const ReleaseSchema = Type.Object(
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
