# minimum-release-age-guard

PreToolUse Edit/Write hook that blocks additions to `pnpm-workspace.yaml`
`minimumReleaseAge.exclude[]`.

## Why

`pnpm`'s `minimumReleaseAge` (typically set to `7d`) refuses to install
packages whose npm publish date is younger than the cap. The cap is
malware-soak protection: packages published within the last week are still
in the suspicion window for typosquats, postinstall malware, and supply-chain
attacks that haven't yet been caught by Socket / npm / community signal.

`minimumReleaseAge.exclude[]` opts specific packages OUT of the soak. Every
entry is a malware-protection hole — and most attempts to add to it are
quick-fix shortcuts to install a package that just published, not legitimate
emergency CVE patches.

## What it blocks

| Pattern                                                             | Block? |
| ------------------------------------------------------------------- | ------ |
| Edit/Write that adds a name to `minimumReleaseAge.exclude[]`        | yes    |
| Edit/Write that removes a name from `minimumReleaseAge.exclude[]`   | no     |
| Edit/Write touching `pnpm-workspace.yaml` but not the exclude array | no     |
| Edit/Write to any other file                                        | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow soak-time bypass

`Allow minimumReleaseAge bypass` still works as an alias. The matcher folds
hyphens to spaces, so `Allow soak time bypass` matches too.

Use sparingly. The legitimate cases are:

- Emergency CVE patch published in the last 7 days.
- First-party package you control (lower attack-surface risk).

## Detection

The hook parses both the current file contents and the after-edit contents
as YAML (permissive, narrow to the `minimumReleaseAge.exclude` block), then
computes the set difference. Names added → block. Names removed or unchanged
→ pass.

Fails open on YAML parse errors — better to under-block than to brick edits
when the file is in a transient bad state.
