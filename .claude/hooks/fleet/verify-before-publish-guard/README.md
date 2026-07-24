# verify-before-publish-guard

PreToolUse guard (Bash) — blocks the publish-family footguns in every repo,
fleet or external:

- **Git-spec misparse:** `npm|pnpm|yarn publish <arg>` whose path arg contains
  `/` without a leading `./`, `../`, `/`, or `~` — npm resolves the bare `a/b`
  shape as the GitHub repository `a/b`, not a local folder. Also fires on
  publish commands embedded in generated snippets (`printf … | pbcopy`).
- **Local publish (redirect):** a live `npm|pnpm publish` / `pnpm stage
  publish` run locally. The fleet publishes from GitHub Actions under OIDC
  trusted publishing + provenance; the block teaches the sanctioned entry —
  the release/publish pipeline, whose stage-publish leg dispatches the
  npm-publish.yml workflow and watches the run. Carve-out: the one-time
  `npm publish` of a `0.0.0` placeholder (trusted-publishing bootstrap).
- **Local `cargo publish` (redirect):** crates.io publishes are irreversible;
  the sanctioned entry is the cargo engine (`cargo-publish.mts --approve`),
  which orders publish → crates.io index liveness → tag + GH release LAST.
  A `--dry-run` preview passes.
- **Direct publish-runner scripts (redirect):** `node …npm-publish.mts` run
  directly, or `publish-pipeline.mts --local` — both publish from the local
  machine outside the pipeline receipts. The plain `publish-pipeline.mts`
  (no `--local`) is the sanctioned entry and passes. `--dry-run` passes.
- **Unverified publish:** a non-`--dry-run` publish with no same-session
  registry-read receipt (`npm|pnpm view|info|show`, `gh release view`,
  `gh api …/releases…`, or `cargo search` in a recent assistant Bash call).
  Run the read first; the retry passes.

Detection is AST-based (`_shared/shell-command.mts`); embedded snippets are
found by whitespace-token scanning of parsed string arguments.

Bypass: `Allow verify-before-publish bypass`.

Rule: [`verify-state-before-acting`](../../../../docs/agents.md/fleet/verify-state-before-acting.md)
