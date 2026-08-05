/*
 * @file Repo-policy blocks of the socket-wheelhouse config: path-hygiene gate
 *   exemptions and the release / version-bump policy.
 */

import { Type } from 'typebox'

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

export const ReleaseLineSchema = Type.Object(
  {
    branch: Type.Optional(
      Type.String({
        description:
          'The ref the customer release line lives on, e.g. `origin/v1.x`. Set it only when releases are cut somewhere other than the branch being scanned — a repo may carry several independent release lines at once, and their divergence is the architecture rather than a defect. Consumers resolve the release boundary as the newest tag reachable from THIS ref instead of from the scanned ref. Second in precedence: `boundaryTag` overrides it, and `tagPattern` filters the ancestry search it selects the ref for.',
      }),
    ),
    boundaryTag: Type.Optional(
      Type.String({
        description:
          "The tag that IS the release boundary, e.g. `v1.1.152`. First in precedence — it overrides `branch` and `tagPattern` alike, because it names the answer outright and leaves nothing to search. Use it when the line's newest release is not the newest tag reachable from any ref — history at or below this tag is published and frozen, so scripts/fleet/check/commits-have-no-ai-attribution.mts reports findings there as frozen instead of actionable.",
      }),
    ),
    tagPattern: Type.Optional(
      Type.String({
        description:
          'A `git tag --list` glob naming which tags are RELEASE tags, e.g. `v*`. Set it when the repo pushes tags that are not releases — build-asset and bundle tags such as `fleet-pack-<sha>` or `base-assets-<date>-<sha>` sit on the same branch and are newer, so an unfiltered newest-ancestor pick lands on one of them instead of the real release. The glob filters the candidate tags BEFORE the newest-ancestor pick, so only matching tags can become the boundary. Third in precedence: `boundaryTag` wins outright, `branch` chooses which ref the ancestry search walks, and this narrows what that search may return. Unlike a hand-pinned `boundaryTag` it does not go stale — the next release tag matching the glob becomes the boundary on its own. A declared pattern that matches no ancestor tag fails loud rather than falling back to unfiltered ancestry, since a silent fallback would reinstate the asset tag the pattern exists to exclude.',
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Where this repo's customer release line lives, for gates that must tell published history from rewritable history. Resolved OFFLINE and by ANCESTRY: never by tag recency, since the newest tag by date can belong to a release line that never ships. Precedence is `boundaryTag`, then `branch`, then `tagPattern` filtering the ancestry search, then unfiltered ancestry.",
  },
)

export const ReleaseSchema = Type.Object(
  {
    releaseLine: Type.Optional(ReleaseLineSchema),
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
    latestDistTagBranch: Type.Optional(
      Type.String({
        description:
          "The branch that owns the `latest` npm dist-tag — the line customers get from a bare `npm install <pkg>`. Defaults to the repo's default branch, which is right for almost every member; set it only when the consumable line lives elsewhere, such as a maintenance branch shipping to users while the default branch carries a prerelease major. npm-publish.yml refuses a `latest` publish dispatched from any other branch.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: 'Release / version-bump policy.',
  },
)
