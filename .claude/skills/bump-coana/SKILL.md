---
name: bump-coana
description: Update the pinned Coana CLI, native help snapshots, and changelog. Use when bumping Coana CLI.
allowed-tools: Read, Edit, Write, Bash, Glob
user-invocable: true
---

# Bump the Coana CLI

For a new release, check for the Socket CLI PR created by Coana's `Publish CLI` workflow (`publish-cli.yml`). It normally opens the PR and refreshes `src/vendor/coana-cache.mjs`. Continue on that PR instead of opening a duplicate. Use these steps for a manual bump.

Take the exact Coana version as `$ARGUMENTS` in `X.Y.Z` form; ask if it is
missing. Read [the pin and snapshot notes](references/pin-and-snapshots.md).

1. Read the current `COANA_CLI_VERSION` as `$CURRENT_VERSION`, then update it
   in `src/constants.mts`. Leave `src/vendor/coana-cache.mjs` and the root
   `package.json` version unchanged.
2. Refresh the native help snapshots:

   ```sh
   node scripts/refresh/snapshots/swap-version.mts \
     --dep coana --from "$CURRENT_VERSION"
   ```

   If the helper cannot update them, run `pnpm snapshots:refresh:dep coana` with
   a built native CLI.
3. Add or replace the Unreleased changelog entry:

   ```sh
   node scripts/release/add-unreleased.mts \
     --replace '^Updated the Coana CLI to v ' \
     "Updated the Coana CLI to v \`$ARGUMENTS\`."
   ```

   Leave release headings and the top-level package version to the release
   workflow.
4. Run `pnpm run test:unit:snapshot-dependencies`. Create one signed
   conventional commit and open a PR against `v1.x`.
