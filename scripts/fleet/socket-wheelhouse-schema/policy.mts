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

export const ProvenanceOrphanBaselineEntrySchema = Type.Object(
  {
    id: Type.String({
      description:
        'The published artifact as `<pkg>@<version>`, e.g. `@socketsecurity/lib@6.5.0`. Matched exactly against the audited package name and version.',
    }),
    reason: Type.String({
      description:
        'Why this orphan is grandfathered rather than fixed. Required — one line.',
    }),
  },
  {
    additionalProperties: false,
    description: 'One grandfathered provenance orphan.',
  },
)

export const ReleaseSchema = Type.Object(
  {
    provenanceOrphanBaseline: Type.Optional(
      Type.Array(ProvenanceOrphanBaselineEntrySchema, {
        description:
          'Published versions frozen in a state no commit can repair, grandfathered so check/release-tags-match-provenance.mts reports them informationally instead of failing. Covers both kinds: a version whose attested commit no release tag reaches, and a version published with NO attestation at all (npm mints attestations at publish time and they are immutable, so provenance can never be added retroactively). A RATCHET: history is frozen and its only remedy is a human decision, so it may not block main — but any version NOT listed here fails the gate, which is what forces every new release through the pipeline with publishConfig.provenance:true, and an entry whose version has since been reconciled fails as STALE so the list can only shrink.',
      }),
    ),
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
