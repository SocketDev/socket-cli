# Fleet security stack

Aggregator doc: every security-relevant hook, scanner, and gate the fleet ships, in one place. Referenced from the discrete rule sections in CLAUDE.md when you need the full picture.

The stack assumes three threat models in priority order:

1. **Supply-chain compromise** (the Nx Console pattern: malicious npm package exfiltrates local credentials within seconds of install)
2. **Stolen credential reuse** (a token leaks via a screenshare, an exposed dotfile, a published commit; attacker uses it before rotation)
3. **Operator mistake** (accidentally pushing an unsigned commit, an `.env` with a real token, a workflow with `pull_request_target` misuse)

Layered enforcement, with each layer catching what the previous one missed.

## Layer 1: never let secrets touch disk

| Surface                    | Hook / mechanism                              | What it blocks                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Socket API token storage   | `.claude/hooks/no-token-in-dotenv-guard/`     | Write/Edit of any `.env*`/`.envrc` file containing a real token                                                                                                                                             |
| Keychain read invocations  | `.claude/hooks/no-blind-keychain-read-guard/` | Bash calls to `security find-*-password`, `secret-tool lookup`, `Get-StoredCredential`, `keyring get` — these surface UI prompts per call and the token is already cached in-process                        |
| Token detection in commits | `.git-hooks/pre-commit.mts` + `pre-push.mts`  | Staged files containing AWS keys, GitHub tokens (`ghp_`/`gho_`/`ghr_`/`ghs_`/`ghu_`/`github_pat_`), Socket API tokens, or any PEM private key (RSA / EC / DSA / OPENSSH / ENCRYPTED / PGP / generic PKCS#8) |
| gh CLI token storage       | `.claude/hooks/gh-token-hygiene-guard/`       | Bash invocations of `gh` when the token is in the on-disk `~/.config/gh/hosts.yml` — must be `(keyring)`                                                                                                    |

## Layer 2: gate access to dangerous capabilities

| Capability                       | Hook                                                    | Gate                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh workflow run` / dispatch     | `.claude/hooks/gh-token-hygiene-guard/`                 | Token must have `workflow` scope (off by default) AND a fresh `Allow workflow-scope bypass` chat phrase AND Touch ID / password auth AND unconsumed grant marker. Single-use: each dispatch consumes the grant.      |
| GitHub Actions workflow_dispatch | `.claude/hooks/release-workflow-guard/`                 | Blocks `gh workflow run`/`dispatch` against publish/release workflows. Bypass: `--dry-run=true` (if workflow declares `dry-run:` input) OR `Allow workflow-dispatch bypass: <workflow>` typed verbatim               |
| Pre-existing branch protection   | `lint-github-settings.mts`                              | Audits the default branch's protection on GitHub for `required_signatures`, `required_pull_request_reviews` (≥1 + dismiss_stale_reviews), `allow_force_pushes=false`, `allow_deletions=false`, `enforce_admins=true` |
| Commit signing                   | `.git-hooks/pre-commit.mts` + `.git-hooks/pre-push.mts` | Pre-commit: `commit.gpgsign=true` + `user.signingkey` set. Pre-push: `git log --format='%G?'` excludes `N` and `B` for commits landing on `main`/`master`.                                                           |
| Hook bypass attempts             | `.claude/hooks/no-revert-guard/`                        | Blocks `git revert`, `--no-verify`, `DISABLE_PRECOMMIT_*`, `--no-gpg-sign`, force-push — all gated by canonical `Allow X bypass` phrases                                                                             |

## Layer 3: enforce token lifetime

| Token                                                    | Mechanism                                              | Window                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gh CLI token                                             | `.claude/hooks/gh-token-hygiene-guard/` 8-hour age cap | Errors when token >8h since last `gh auth login` or `gh auth refresh`. Self-recovery: `gh auth refresh` is always allowed.                                                                |
| GitHub Actions `GITHUB_TOKEN`                            | GitHub-provided                                        | 1 hour per workflow run, scope-limited by the workflow's `permissions:` block                                                                                                             |
| Authenticated CLIs (npm, pnpm, gcloud, docker, vault, …) | `.claude/hooks/auth-rotation-reminder/`                | Stop-hook periodically logs you out of stale long-lived sessions. `gh` is exempt from auto-logout (would break in-session work); its age check lives in `gh-token-hygiene-guard` instead. |

## Layer 4: workflow + repo audit

| Surface                      | Hook / scanner                                      | When it fires                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions workflow YAML | `.claude/hooks/actionlint-on-workflow-edit/`        | PostToolUse after Edit/Write to `.github/workflows/*.y*ml`. Runs `actionlint` (YAML / shell / SHA-pin) + `zizmor` (security: privilege escalation, secret leaks, untrusted-input-in-script, `pull_request_target` misuse) |
| `pull_request_target` misuse | `.claude/hooks/pull-request-target-guard/`          | Blocks Edit/Write that creates a `pull_request_target` workflow checking out the fork head + executing the checked-out code in the same job                                                                               |
| Workflow `uses:` SHA pinning | `.claude/hooks/workflow-uses-comment-guard/`        | Every SHA-pinned `uses:` line needs a `# <tag> (YYYY-MM-DD)` comment for staleness tracking                                                                                                                               |
| Workflow heredoc bodies      | `.claude/hooks/workflow-yaml-multiline-body-guard/` | Blocks `gh ... --body "..."` (multi-line markdown breaks YAML) in favor of `--body-file <path>`                                                                                                                           |
| GitHub repo settings         | `scripts/lint-github-settings.mts`                  | Audits visibility, merge settings, branch protection, required apps. Weekly cache-gated; CI doesn't burn API quota                                                                                                        |
| AgentShield + zizmor         | `/scanning-security` skill                          | A-F graded report on `.claude/` config + workflow YAML. Run after touching `.claude/` or workflows, before releases                                                                                                       |

## Layer 5: catch the operator mistake

| Mistake                                | Hook                                                     | What it catches                                                        |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Pushing a real customer / company name | `.claude/hooks/private-name-guard/`                      | Real names in commits / PR text / release notes                        |
| Linear ticket refs                     | `.claude/hooks/private-name-guard/`                      | `SOC-123`, `ENG-456`, Linear URLs in code or PR text                   |
| External issue refs (auto-link spam)   | `.claude/hooks/no-external-issue-ref-guard/`             | `<owner>/<repo>#<num>` in commits or PR bodies for non-SocketDev repos |
| Empty commits                          | `.claude/hooks/no-empty-commit-guard/`                   | `git commit --allow-empty`, `cherry-pick --allow-empty`                |
| `--no-verify` use                      | `.claude/hooks/no-revert-guard/`                         | Hook bypass via `--no-verify` without typed bypass phrase              |
| Personal paths in code                 | `pre-commit.mts` / `pre-push.mts`                        | `/Users/<name>/`, `/home/<name>/`, `C:\Users\<NAME>\`                  |
| Cross-repo path imports                | `.claude/hooks/cross-repo-guard/` + `scanCrossRepoPaths` | `../<fleet-repo>/` and absolute `/projects/<fleet-repo>/` references   |

## Setup helpers

One-time helpers that configure the local machine to satisfy the layers above:

```sh
# Master umbrella: runs every installer in sequence
node .claude/hooks/setup-security-tools/install.mts
node .claude/hooks/setup-security-tools/install.mts --rotate  # rotate API token

# Scoped leaves
node .claude/hooks/setup-firewall/install.mts          # sfw (Socket Firewall)
node .claude/hooks/setup-claude-scanners/install.mts   # AgentShield + zizmor
node .claude/hooks/setup-basics-tools/install.mts      # TruffleHog + Trivy + OpenGrep + uv
node .claude/hooks/setup-misc-tools/install.mts        # cdxgen + synp + janus
node .claude/hooks/setup-signing/install.mts           # commit signing (1Password SSH → ~/.ssh → GPG)
```

## Post-hoc forensics

```sh
node scripts/audit-transcript.mts --recent    # scan most recent session
node scripts/audit-transcript.mts <path>      # scan a specific transcript
node scripts/audit-transcript.mts --json …    # JSON output for tooling
```

Read-only diagnostic. Reads the Claude Code transcript JSONL and flags tool-use patterns that touched security-sensitive surfaces: `gh auth` flows, keychain CLI reads, `dscl -authonly` calls, `sudo` invocations, private-key file access, workflow YAML edits, git pushes. Never blocks; surfaces what an agent session did with privileged tooling.

Useful after a session that touched the security stack, before declaring it "done." The output reads like a security audit log: critical / warn / info tiers, grouped by category, with line-numbered evidence pointing back into the transcript.

## Detailed specs

Each layer has a dedicated long-form doc:

- [`token-hygiene.md`](./token-hygiene.md): Socket API token storage, env-var aliases, keychain mechanics
- [`gh-token-hygiene.md`](./gh-token-hygiene.md): gh CLI specific (Nx-incident response, keyring, workflow scope, 8h cap, Touch ID setup)
- [`commit-signing.md`](./commit-signing.md): three-layer signing enforcement, setup helper, when to use bypass envs
- [`bypass-phrases.md`](./bypass-phrases.md): canonical phrase forms, scope per phrase
- [`public-surface-hygiene.md`](./public-surface-hygiene.md): never-write rules for customer / company / Linear references
- [`pull-request-target.md`](./pull-request-target.md): privileged-context threat model + safer patterns

## Bypass discipline

Every bypass mechanism is one-shot. No env var in `~/.zshrc`. No persistent setting. The reason: bypasses exist for exceptional scenarios; if you find yourself reaching for the same bypass repeatedly, the underlying rule is the wrong one and should be fixed at the source.

When a hook blocks you, the right responses in order of preference:

1. **Fix the underlying issue.** Sign the commit. Use a `--body-file`. Drop the personal path. Use the canonical fleet helper.
2. **Add a per-line marker** if the rule has one (e.g. `// socket-hook: allow console` for the console-prefer-logger rule). Documents the exemption inline.
3. **Type the canonical bypass phrase** if the operation is exceptional. The phrase is one-shot: typing it again authorizes a second action.
4. **Last resort: edit the hook** to change the rule. If the rule blocks you twice for the same kind of operation, it's the wrong rule, not the wrong commit. Land the change at the source so every fleet repo benefits.

Persistent env vars (`SOCKET_X_DISABLED=1` in shell rc) defeat the discipline the layered enforcement is meant to provide. The hook authors deliberately removed escape hatches in 2026-05 (`SOCKET_GH_HYGIENE_DISABLED`, `SOCKET_GH_TOKEN_AGE_DISABLED`, and `SOCKET_GH_HYGIENE_TEST_AUTH` were all deleted after the Nx Console breach made the "failsafe-deny on supply-chain credentials" stance non-negotiable).

## Known gaps (acknowledged, not yet closed)

The red-hat review (2026-05-26) surfaced two gaps that require off-repo work to close. Documented here so the threat model stays honest:

1. **Transcript JSONL is unauthenticated.** `bypassPhrasePresent()` trusts the JSONL at `~/.claude/projects/<id>/<session>.jsonl`. A malicious process running as the user can append a forged user turn containing every `Allow X bypass` phrase, and every guard in the fleet will believe it. **Mitigation when ready:** the Claude Code harness must HMAC user turns with a per-session secret; hooks would verify the HMAC and reject unsigned turns. Until then, the bypass model is **trust-on-first-use** at the OS level — any process running as the user can defeat every bypass-gated guard. The defense in depth is the OS-level Touch ID prompt on the gh-token-hygiene-guard workflow scope path, which is the only step that requires physical presence.

2. **Shell-command detection: shell-quote parser, not a full evaluator (RESOLVED for the common cases).** `gh`/`git` detection in the Bash-allowlist guards (`gh-token-hygiene-guard`, `no-non-fleet-push-guard`) now goes through the shared shell parser (`.claude/hooks/_shared/shell-command.mts`, wrapping `shell-quote`), not regex. This sees through `&&`/`|`/`;` chains, `$(…)` substitution, and quoting, and it killed the regex false positives (a `grep "gh workflow"` is no longer treated as a `gh` invocation). The parser tokenizes rather than evaluates, so a binary fully sourced from a variable (`MYGH=gh; $MYGH …`) still can't be resolved to `gh` — but the parser FLAGS it as opaque (`hasOpaqueInvocation`), and an alias / wrapper script remains out of scope for any static parser.

Gap 1 is upstream of the per-hook implementation (Claude Code runtime change); gap 2 is now closed for the practical cases via the shared parser. The residual variable/alias indirection is a fundamental static-analysis limit, mitigated by the bypass-phrase + OS-presence layers above.
