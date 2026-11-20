---
name: bump-node-sea
description: Update the Node runtime bundled in the native CLI. Use when changing src/sea/.node-version.
user-invocable: true
---

# Bump the SEA Node runtime

Take the exact official Node release version as `$ARGUMENTS`; ask if missing.
Read [the Node pin reference](references/pin-and-qualification.md), then update
`src/sea/.node-version`.

Confirm the official Node release publishes the required archive for each
supported SEA target and exposes the SEA/VFS APIs the builder uses. Build the
native prototype first. It updates the README marker from the new pin:

```sh
pnpm build:sea
```

Then run the Node pin and SEA builder tests:

```sh
pnpm run test:unit \
  test/unit/sea/version.test.mts test/unit/sea/build-sea.test.mts
```

Check that `src/sea/README.md`'s marked version follows the pin. Do not claim
qualification for a target that was not built and tested. Add a changelog
entry when the runtime change affects released binaries. Create one signed
conventional commit and a PR against `v1.x`.
