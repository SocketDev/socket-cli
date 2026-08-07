# Immutable references

Every external reference the fleet commits - an action pin, a container image,
a downloaded release asset, a submodule - names immutable content. The sha is
the reference the machine trusts; any version label beside it is a comment for
humans.

## The three rules

- **Reference the sha.** The machine-read half of a reference is a content
  address: a 40-hex commit sha, an image digest, or a `sha256:` file hash. The
  human-read half is a trailing label comment: `<sha> # v3.2.1` for a tag pin,
  and `<sha> # main 2026-08-07` for a branch pin, where the date records when
  the branch was read.
- **Verify integrity on download AND extract.** Pinning names the bytes;
  verification proves them. A fetched archive is checked against its recorded
  checksum before extraction, and every extracted file is checked against its
  manifest hash after.
- **One checksum vocabulary.** A checksum is written `sha256:<hex>` on every
  surface: manifests, lockstep pins, and release checksum files. Tools then
  compare hashes without guessing the encoding.

## Why

A moved tag serves different bytes under an unchanged reference. `v3.2.1` can
point at one commit today and a different commit tomorrow, and every consumer
that trusted the label re-fetches the swap without a single diff appearing
anywhere. Labels are for humans; content addresses are for machines. A sha or
digest cannot be repointed, so the thing you audited is the thing that runs,
and a label that drifts away from its sha surfaces as a supply-chain signal
instead of an invisible swap.

## Per-surface syntax

| Surface                 | Form                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------- |
| YAML, Dockerfile, shell | `<ref>@<sha> # v3.2.1` - the label rides a `#` comment                                  |
| `.mts` source           | `// v3.2.1` beside the pinned sha                                                       |
| JSON                    | a sibling `refLabel` key, since JSON has no comments                                    |
| Content-addressed names | no label needed - a name like `fleet-pack-<sha>` carries its address in the name itself |

## Channels

- **GHCR is the primary channel for internal machine pulls.** A GHCR digest is
  immutable and a GHCR tag is mutable, so machine pulls content-address the
  image: pin the digest, or use a content-addressed tag such as
  `fleet-pack-<sha>`.
- **GitHub Releases and tags serve outside consumers.** People browse releases
  and download assets by label, so the human channel keeps its labels. The
  release is the side effect of pushing the tag, and its assets ship with a
  checksums file so a download verifies the same way an internal pull does.

## Enforcement

- `scripts/fleet/check/external-refs-carry-sha-and-label.mts` - every external
  reference carries both the sha and its label comment.
- `scripts/fleet/check/pinned-labels-match-shas.mts` - release/CI tier; each
  `<sha> # v<label>` pin still resolves to the sha its upstream tag names, so
  a silently moved tag fails loud.
- `scripts/fleet/check/container-refs-are-digest-pinned.mts` - every container
  reference is digest-pinned or content-addressed.
- `scripts/fleet/build-infra/lib/release-checksums/consumer.mts` - a consumed
  release asset is checked against its `checksums.txt` before use.
- `verifyBundleFiles` in `scripts/repo/bootstrap/fleet.mjs` - every unpacked
  bundle file is verified against the bundle manifest's sha256.
