# verify-before-publish-guard

PreToolUse guard (Bash) — blocks two publish-family footguns in every repo,
fleet or external:

- **Git-spec misparse:** `npm|pnpm|yarn publish <arg>` whose path arg contains
  `/` without a leading `./`, `../`, `/`, or `~` — npm resolves the bare `a/b`
  shape as the GitHub repository `a/b`, not a local folder. Also fires on
  publish commands embedded in generated snippets (`printf … | pbcopy`).
- **Unverified publish:** a non-`--dry-run` publish with no same-session
  registry-read receipt (`npm|pnpm view|info|show`, `gh release view`,
  `gh api …/releases…`, or `cargo search` in a recent assistant Bash call).
  Run the read first; the retry passes.

Detection is AST-based (`_shared/shell-command.mts`); embedded snippets are
found by whitespace-token scanning of parsed string arguments.

Bypass: `Allow verify-before-publish bypass`.

Rule: [`verify-state-before-acting`](../../../../docs/agents.md/fleet/verify-state-before-acting.md)
