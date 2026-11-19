---
name: bump-socket
description: Prepare the next Socket CLI npm release on stable v1.x or the native 2.1 prerelease track.
user-invocable: true
---

# Prepare a Socket CLI release

Take `v1` or `native` as `$ARGUMENTS`; ask if the lane is missing or unclear.
Use the release workflow; do not edit package versions or changelog headings
by hand. Read [the release lanes](references/release-lanes.md), then dispatch a
dry run for the requested lane:

```sh
# Stable v1.x: socket, @socketsecurity/cli, and @socketsecurity/cli-with-sentry
gh workflow run publish-npm.yml --ref v1.x \
  -f mode=release-pr -f dry-run=true -f release-major=1

# Native 2.1 prerelease: socket only
gh workflow run publish-npm.yml --ref v1.x \
  -f mode=release-pr -f dry-run=true -f release-major=2
```

Review the proposed version and changelog output. If the requested task is to
prepare the release PR, rerun with `dry-run=false`; do not ask again for that
authorization. Do not dispatch `mode=publish` as part of bump preparation.
Report the workflow run and resulting PR.
