# Publish provenance: why bump-in-CI mints orphans

Every release published with `bump: true` produces a version whose SLSA
attestation names a commit that never shipped. Three socket-lib versions carry
the identical baseline reason for it. This page is why, and what to do instead.

## The mechanism

npm derives provenance from the workflow run's `GITHUB_SHA`. That value is
fixed when the run STARTS. The publish flow then does this:

1. checks out `GITHUB_SHA`, the pre-bump commit,
2. bumps the version onto a release branch,
3. packs and publishes, so npm attests `GITHUB_SHA`,
4. fast-forwards `main` to the release-branch tip on success.

The bump commit is created DURING the run, so it cannot be the run's
`GITHUB_SHA`. The attested tree therefore carries the previous manifest, and
the tree that actually shipped is a commit the attestation never names.

<details>
<summary><b>What it looks like when it bites</b> - the 6.6.0 case, end to end</summary>

- npm attested `32435898`, whose `package.json` read `6.6.0-prerelease`.
- The shipped bump commit was `55f971b7`, reading `6.6.0`.
- `release-tags-match-provenance` reports an unbaselined provenance orphan: no
  tag can mark both commits, and tagging the attested one would tag a tree that
  was never published.
- The reconcile healer cannot repair it either. It resolves the flip commit,
  checks it out, re-packs, and the bytes diverge from the registry - because
  the published bytes came from a build the attestation attributes elsewhere.
- The check calls this a HUMAN DECISION and refuses to guess, which is correct:
  it will not tag a commit nobody has confirmed against the published bytes.

Same reason recorded for 6.5.0 and 6.5.1. It is not three accidents.

</details>

## Reordering inside one run cannot fix it

This is the part worth internalising before attempting a fix. `GITHUB_SHA` is
set at dispatch. Moving the bump earlier in the job, splitting it into a
separate job, or pointing `checkout-ref` somewhere else all leave the run's
`GITHUB_SHA` unchanged. A commit created during a run is never that run's SHA.

## There are two routes, and only one of them orphans

This is the part to get right before "fixing" anything. `npm-publish.yml` takes
a `bump` input, and the two callers use it differently ON PURPOSE
(`npm-publish.yml` around the Publish step spells this out):

| route                    | `bump`           | what happens                                                                                                                                          |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish-pipeline.mts`   | `false`          | Its own bump stage already landed the bump commit, so the dispatch starts AT that commit. `GITHUB_SHA` is the shipped tree and provenance is correct. |
| manual `gh workflow run` | `true` (default) | The hint-consuming convenience flow. The bump happens in CI, so `GITHUB_SHA` is the pre-bump commit and the release orphans.                          |

So the pipeline is already the two-phase flow. Nothing is missing, and the
default is NOT the bug: flipping `bump` to `false` would break the manual
hint-consuming route, which exists deliberately and runs the bump exactly once
across the chain.

<details>
<summary><b>How 6.6.0 orphaned</b> - a worked example of picking the wrong route</summary>

It was published with `gh workflow run npm-publish.yml -f publish=true -f
bump=true`. That is the manual route. The run's `head_sha` was `32435898`,
carrying the `6.6.0-prerelease` manifest; the bump landed afterwards as
`55f971b7`. npm attested `32435898`, so the tag had nowhere correct to go.

Nothing malfunctioned. The manual route did exactly what it says it does. The
mistake was reaching for it instead of the pipeline for a real release.

</details>

## What to actually do

**Release through `publish-pipeline.mts`.** It sequences the bump and the
dispatch so provenance lands on the shipped commit. Reach for a manual
`bump=true` dispatch only when a release does not need a tag to mark it.

If a release has already gone out the manual way, it cannot be repaired -
attestations are immutable. Baseline it in
`release.provenanceOrphanBaseline` with the reason, which is what 6.5.0, 6.5.1
and 6.6.0 carry. Baselining does not weaken the gate: a version absent from
that list still fails, which is what keeps releases pointed at the pipeline.
