# release-defers-to-script-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2). Fleet-scoped convention.

**Rule:** the release is code-is-law. In a fleet-managed repo the release +
publish pipeline scripts OWN every release step, so the agent must STOP
reasoning about releases and just run them. This guard blocks a HAND-ROLLED
release step run from Bash, because reaching for one means doing by hand what
the script already owns end to end.

## What it blocks

- `npm|pnpm|yarn version <arg>` — a manifest version mutation. A bare `npm
  version` with no argument only prints and passes.
- `npm|pnpm|yarn publish` — a registry publish.
- `npm pkg set version=<x>` — a manifest version write by another route.
- a package.json `"version"` edit via `sed`, `perl`, or `jq`, or a shell
  redirect that writes package.json a version value.
- `git tag <v-semver>` — creating a release tag, and `git push --tags` / `git
  push --follow-tags` / `git push <remote> <v-semver>` — pushing one.
- a direct `node scripts/fleet/bump.mts` run — the bump is reached only THROUGH
  the pipeline, never called directly.

## What it allows

- `node scripts/fleet/release-pipeline.mts` with any args, with or without
  `--version` — the script derives or consumes the version, prerelease hints
  included, so the agent must NOT reason about which version to pass.
- `node scripts/fleet/publish-pipeline.mts` with any args.
- read-only git - `status` / `log` / `diff` / `tag -l` / `show` — and every
  non-release command. Those match no rule.

<details>
<summary><b>How it decides</b>: the pure <code>decideReleaseGuard</code> function, AST command parsing, the CI and non-fleet stand-downs, the stable error code, the bypass phrase, and fail-open behavior</summary>

**Pure decision:** `decideReleaseGuard(command)` returns `{ blocked, reason }`.
It is exhaustively unit-tested without touching the filesystem. The wrapper adds
the CI passthrough, the fleet-membership scope stand-down, and the bypass
phrase.

**Parsing:** each git / npm / pnpm / yarn / node segment is AST-parsed via
`commandsFor`, robust to leading env assignments, `git -C <path>`, quoting, and
`&&` / `;` chains — so a quoted "npm publish" inside a message never
false-fires.

**Does NOT fire when:**

- the context is CI — `CI` / `GITHUB_ACTIONS` / `CONTINUOUS_INTEGRATION` set. CI
  runs the release through its own workflow, not an interactive agent.
- the acted-on repo is not fleet-managed — `scope: 'convention'` stands the hook
  down in a foreign repo.

**Stable code:** `ERR_FLEET_RELEASE_DEFERS_TO_SCRIPT` in the block message.

**Bypass:** `Allow release-script bypass` typed verbatim in a recent user turn.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Bash call.

</details>
