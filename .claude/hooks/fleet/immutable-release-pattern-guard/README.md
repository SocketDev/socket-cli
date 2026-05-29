# immutable-release-pattern-guard

PreToolUse Edit/Write hook that blocks introducing a single-call
`gh release create <tag> <files>` into a workflow YAML file.

## Why

GitHub immutable releases ([GA 2025-10-28](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/))
auto-generate a Sigstore-bundle release attestation at publish-time over
the locked asset set. The single-call `gh release create` form combines
create + upload + publish into one action, which can race the
attestation hash before all assets land — the resulting release may
publish without a verifiable attestation.

The fleet rule is the 3-step pattern:

```bash
gh release create "$TAG" --draft --title "$TITLE" --notes "$NOTES"
gh release upload "$TAG" <files...>
gh release edit "$TAG" --draft=false
```

The `--draft` flag on `gh release create` is the marker. The publish
step is `gh release edit ... --draft=false` (a different verb).

## What it blocks

| Pattern                                                        | Block? |
| -------------------------------------------------------------- | ------ |
| `gh release create "$TAG" --draft --title ... --notes ...`     | no     |
| `gh release create "$TAG" --draft=true ...`                    | no     |
| `gh release create "$TAG" --title ... --notes ... file.tar.gz` | yes    |
| `gh release create "$TAG" file.tar.gz` (drive-by)              | yes    |
| `gh release edit "$TAG" --draft=false`                         | no     |
| Same pattern outside `.github/workflows/*.y*ml`                | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow immutable-release-pattern bypass

Use sparingly — releases without verifiable attestations defeat the
supply-chain audit trail downstream consumers rely on.

## Detection

Regex over the after-edit text: find each `gh release create` opener,
walk to the next unescaped newline (respecting backslash line
continuations), check whether the captured call includes the `--draft`
flag. Any non-draft call is a violation.

## Related

- Fleet doc: [`docs/claude.md/fleet/immutable-releases.md`](../../docs/claude.md/fleet/immutable-releases.md)
- Fleet doc: [`docs/claude.md/fleet/version-bumps.md`](../../docs/claude.md/fleet/version-bumps.md)
- Memory: `feedback_immutable_releases_three_step.md`
