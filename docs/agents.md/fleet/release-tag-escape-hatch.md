# Release-tag escape hatch

A fleet release carries a `v<version>` git tag. That tag is **immutable** — it
cannot be moved and it cannot be deleted. When a release turns out broken, the
corrective marker is a **bare-semver tag** (`0.0.19`, no `v`) pushed at the
right commit. Two tags for one version is a sanctioned state, not sloppiness.

**The arbiter is the attestation, not the tag name.** npm's SLSA provenance
records the commit that actually produced the published artifact. Whichever tag
resolves to that commit is authoritative; the other is a historical marker.

Enforced by `scripts/fleet/check/release-tags-match-provenance.mts`.

## Why `v*` cannot be fixed in place

The `fleet-tag-protection` ruleset targets `refs/tags/v*` with `deletion` and
`non_fast_forward`, and grants **zero bypass actors**. Tag creation is
deliberately unrestricted so release workflows can push tags; everything after
creation is frozen at the server. `check/release-tags-are-immutable.mts` is the
gate that keeps the ruleset in place across the roster.

This is on purpose. A `v*` tag triggers publish and release workflows, and
GitHub's immutable releases lock their asset set against it. A movable release
tag means a downstream consumer's `git checkout v1.2.3` can silently become a
different tree than the one whose bytes they verified.

So a broken release has no in-place repair. The two legal moves are:

1. **Bump and re-tag.** A publish that errors burns the version — cut the next
   one. Gap versions are supported (`BACKFILL` in `npm-publish.yml`). This is
   the default and the one to reach for.
2. **Push a bare-semver tag** at the correct commit, leaving the wrong `v*` tag
   in place as history. This is the escape hatch, for a release whose artifact
   is already public and correct but whose `v*` tag landed at the wrong commit.

Do **not** widen `fleet-tag-protection` to cover bare-semver tags — that would
freeze the escape hatch itself. Do not delete existing bare tags.

## Peel the tag, always

An annotated tag's own object SHA **is not a commit SHA**. `git rev-parse
refs/tags/<name>` and `git for-each-ref --format='%(objectname)'` both hand you
the tag object; the commit is behind `^{commit}` (or `%(*objectname)`).

This is not a nitpick — it is the single easiest way to misread the escape
hatch. socket-mcp `0.0.19` reads as

```
0.0.19  -> 3911625cf   # the ANNOTATED TAG OBJECT
v0.0.19 -> 145df6e59   # a lightweight tag, already a commit
```

which looks like two tags at two different commits. Peeled, both are
`145df6e59` — the same commit, and the one npm attests. Every bare/`v` pair in
socket-mcp's history peels to the same commit (verified 2026-07-30, all 16
pairs). Read unpeeled, they all look like divergence.

`git ls-remote --tags origin` emits the peeled commit on a sibling `^{}` line;
`parseRemoteTagCommits` in the check always prefers it.

## Resolving which tag is authoritative

```
https://registry.npmjs.org/-/npm/v1/attestations/<scope>%2f<name>@<version>
```

The response holds an **array** of attestations. Two traps:

- **Index 0 is npm's publish attestation**, not the provenance. Its
  `predicateType` is `https://github.com/npm/attestation/tree/main/specs/publish/v0.1`
  and it names no source commit. Select the entry whose `predicateType`
  contains `slsa`; never take `attestations[0]`.
- The statement is a **base64 DSSE envelope**, not inline JSON.

Decoded, the source commit is at
`predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit`, and its
sibling `uri` names the ref the build checked out.

## Failure shapes

**Provenance orphan** — no tag anywhere resolves to the attested commit. The
published artifact has no navigable handle. socket-lib `6.5.0` is the worked
example: provenance attests `e66bd62b`, whose manifest still reads `6.4.0`,
while `v6.5.0` was created later at the bump commit `48b2ba50`. Neither tag
reaches the attested tree.

**No provenance at all** — the registry answers that the version has no SLSA
statement. Nothing can be proven about it, and a published version cannot gain
provenance retroactively. `check/publish-config-is-hardened.mts` is the source-
side gate that keeps `publishConfig.provenance:true` in place.

**Not readable** — the registry could not be reached, or the bundle would not
decode. This is a fact about the environment, not the release. The check exits
0 (an offline CI lane is not a violation) but prints `NOT VERIFIED` and never
the success line. An unread source that reports green is the failure mode this
whole check exists to avoid.

## Branch-ref attestations

Fleet publish workflows bump the version inside the run, so the attested `uri`
names `refs/heads/main` — the branch as it stood mid-run. Verified 2026-07-30:
every one of `@socketsecurity/lib`, `@socketsecurity/mcp`,
`@socketsecurity/sdk`, and `@socketsecurity/registry` attests a branch ref.

A tag-triggered release (`on: push: tags:`) with nothing mutating the tree
in-run attests `refs/tags/<tag>` instead, and then tag, commit, manifest, and
attestation coincide **by construction** rather than by timing. That is the
stronger model and the direction to move.

Until that restructure lands, a branch ref is **reported, not failed** — the
check's `TAG_REF_MODE` constant is the wired-in seam, defaulting to `'report'`.
Flip it to `'strict'` as the ratchet once the fleet publishes off tags. Failing
on it today would fail every member, including the three whose tags are
correct.

## Before you add a missing tag

Resolve the attested commit **first**, then tag it. Do not assume an existing
bare tag names the right commit.

socket-mcp `0.0.3` is the counterexample: the bare `0.0.3` tag peels to
`6fe1ff19`, while npm attests `70cefee9` — a commit no tag points at. Adding a
`v0.0.3` at either the tag object SHA or the peeled commit would enshrine the
wrong tree with a marker nobody can ever move.

Related: [`immutable-releases.md`](immutable-releases.md),
[`version-bumps.md`](version-bumps.md).
