# Immutable releases

The fleet ships **immutable GitHub Releases**: assets locked at publish, tags protected, and a cryptographically verifiable **release attestation** (Sigstore-bundle) produced for every release. GA'd on GitHub 2025-10-28 ([changelog](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/), [docs](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)).

This rule applies to every fleet repo that publishes via `gh release create`: socket-btm + binary releases, every npm publish workflow that also tags a GH release, any `chore(release): vX.Y.Z` workflow.

## Why

- **Tamper evidence**: a downstream consumer of `binsuite-vX.Y.Z.tar.gz` can run `gh release verify <tag>` (or any Sigstore-compatible tool) and prove the asset wasn't modified after publish.
- **Tag protection**: once a release is published immutably, the tag can't be force-moved. Historical bisects and reproducible-build claims stay honest.
- **Asset lock**: nobody can swap a `.tar.gz` for a different one at the same URL post-publish. Defeats one common supply-chain attack class.
- **Audit trail**: the attestation records the release tag, commit SHA, and asset digests as a signed, verifiable artifact.

## Enabling at the repo / org level

Repository setting (UI today; API field not yet exposed as of 2026-05):

> **Settings → General → Releases → ☑ Enforce immutable releases for this repository**

Org-level (recommended; applies to all repos by default):

> **Organization → Settings → Code, planning, and automation → Releases → ☑ Enforce immutable releases for all repositories**

The fleet baseline is **org-level on, no per-repo opt-out**. Run `auditing-gha-settings` periodically to flag drift once the GH API surfaces the toggle.

## Workflow pattern: draft → upload → publish

The `gh release create` direct-publish pattern (single call that creates the release + uploads assets + publishes immediately) **does not produce an attestation reliably** because the attestation hash is computed at publish-time over the locked asset set, and direct-publish can race with asset uploads.

The GitHub-recommended pattern is:

```bash
# 1. Create as draft with notes + title but NO assets.
gh release create "${TAG}" \
  --draft \
  --title "${TITLE}" \
  --notes "${NOTES}"

# 2. Upload assets to the draft. Assets aren't visible to consumers yet.
gh release upload "${TAG}" \
  release/*.tar.gz \
  release/checksums.txt

# 3. Publish the draft. This is the single atomic event that locks the
#    asset set and produces the attestation.
gh release edit "${TAG}" --draft=false
```

🚨 **Workflow rule:** every release workflow under `.github/workflows/` that publishes a GitHub Release MUST use the 3-step pattern. The single-call `gh release create <tag> <files>` form is forbidden in fleet release workflows. A guard hook is on the backlog; today the rule is enforced by review + the existing release-workflow-guard's dispatch policy. To audit: `grep -rn "gh release create" .github/workflows/ | grep -v "\-\-draft"`.

## Verifying a release

```bash
gh release verify <tag>                  # all assets
gh release verify-asset <tag> <asset>    # specific asset
```

These work for anyone outside the org with `gh` installed. The attestation is also readable as raw Sigstore JSON via `gh attestation` for integration with non-`gh` tooling.

## What NOT to do

- **Don't** force-push a tag after a release exists. The tag is protected; the push will be rejected at the server.
- **Don't** delete an asset and re-upload to "fix" it. The release is locked; you'll have to cut a new patch version.
- **Don't** `gh release create <tag> <files...>` as one atomic call. See the workflow rule above.
- **Don't** dispatch a release workflow that uses the legacy direct-publish pattern. Migrate it first.

## Post-publish provenance check

A Stop-hook reminder (`provenance-publish-reminder`) already checks that npm-published artifacts carry `dist.attestations` and `_npmUser.trustedPublisher`. The same hook is extended to verify GH-release-published artifacts carry a release attestation: after `chore: bump version to vX.Y.Z` + `vX.Y.Z` tag, the hook runs `gh release view <tag> --json isImmutable,...` and warns if the release isn't immutable.

## When the repo doesn't qualify

Some fleet repos don't publish releases (private tooling repos, scratch repos). For those, the rule is moot. `gh release create` doesn't appear in their workflows. The hook checks only files matching `.github/workflows/**.yml` that contain a `gh release create` line.

## References

- [Immutable releases: changelog (GA 2025-10-28)](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/)
- [Immutable releases: docs](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [gh release verify CLI](https://cli.github.com/manual/gh_release_verify)
- [gh attestation verify CLI](https://cli.github.com/manual/gh_attestation_verify)
- Related: [`version-bumps.md`](version-bumps.md) (release sequence), [`public-surface-hygiene.md`](public-surface-hygiene.md) (release workflow restrictions).
