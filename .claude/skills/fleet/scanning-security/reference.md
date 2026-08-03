# scanning-security Reference

Rule catalog, interpretation guide, and fix recipes for the `scanning-security` skill. SKILL.md covers the phased workflow; this file covers what the findings mean and how to fix each class.

## Table of contents

1. [AgentShield rule catalog](#agentshield-rules)
2. [Zizmor rule catalog](#zizmor-rules)
3. [Common false positives](#false-positives)
4. [Severity decision tree](#severity-decisions)
5. [Fix recipes](#fix-recipes)
6. [When to skip a check (and how)](#skipping-checks)
7. [Reading the report](#reading-the-report)
8. [Cross-references](#cross-references)

---

<a id="agentshield-rules"></a>

## 1. AgentShield rule catalog

AgentShield scans `.claude/` for Claude Code configuration risks. Rules grouped by what each protects against.

### Hardcoded-secret rules

| Rule                      | What it flags                                                                                           | Default severity |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| `hardcoded-token-literal` | Literal token patterns (`ghp_…`, `sk-…`, JWTs, etc.) in CLAUDE.md, settings.json, agent/skill markdown  | CRITICAL         |
| `env-var-with-value`      | `"FOO_TOKEN=actual-value"` in settings env blocks (env var set to a literal secret, not `${FOO_TOKEN}`) | CRITICAL         |
| `dotfile-leak`            | `.env*` paths written to MCP server configs where the path would be cat'd                               | HIGH             |

**Fix**: replace the literal with an environment-variable reference (`${TOKEN_NAME}`) or move the secret into the shell environment and read via `process.env`. Never commit literals even if redacted with asterisks — git history preserves them.

### Tool-allowlist rules

| Rule                      | What it flags                                                               | Default severity |
| ------------------------- | --------------------------------------------------------------------------- | ---------------- |
| `bash-wildcard-allowlist` | `"Bash(*)"` or `"Bash(.*)"` in allow list                                   | HIGH             |
| `overly-broad-glob`       | `"Read(/**)"` or a home-directory wildcard — broader than the work requires | MEDIUM           |
| `unknown-tool-allowed`    | A tool name not recognized by Claude Code's catalog                         | MEDIUM           |

**Fix**: narrow the allow list to the specific commands / paths the workflow actually uses. The allow list is a security boundary, not a convenience list.

### Prompt-injection rules

| Rule                               | What it flags                                                                                                              | Default severity |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `instruction-override-in-agent-md` | Text in agent / skill markdown that looks like "ignore previous instructions" or asks Claude to override its system prompt | HIGH             |
| `executable-content-in-md`         | Shell-looking blocks not fenced as code — Claude may execute them literally                                                | MEDIUM           |
| `external-url-to-fetch`            | Hard-coded URLs to fetch third-party content at runtime without a SHA pin                                                  | MEDIUM           |

**Fix**: fence all shell blocks as markdown code blocks. Pin any external fetch by SHA. Never include "override this" language in agent definitions.

### Command-injection-in-hooks rules

| Rule                         | What it flags                                                      | Default severity |
| ---------------------------- | ------------------------------------------------------------------ | ---------------- |
| `hook-uses-unquoted-var`     | Hook command contains `$VAR` without quotes                        | HIGH             |
| `hook-shells-out-to-tmpfile` | Hook writes a temp file then executes it                           | CRITICAL         |
| `hook-concats-user-input`    | Hook interpolates `$1` / `$CLAUDE_ARG` into a shell command string | HIGH             |

**Fix**: hooks should use array-form commands (`["cmd", "arg1", "$VAR"]`) or explicit argv parsing. Avoid shell interpolation of any variable the user or model can influence.

### MCP-server rules

| Rule                       | What it flags                                            | Default severity |
| -------------------------- | -------------------------------------------------------- | ---------------- |
| `mcp-server-arbitrary-url` | MCP server URL is a template that can be user-controlled | HIGH             |
| `mcp-server-no-auth`       | Remote MCP server configured without auth token          | MEDIUM           |
| `mcp-server-stdio-shell`   | Stdio server that invokes `/bin/sh -c …`                 | HIGH             |

**Fix**: pin MCP server URLs to literal origins. Wrap stdio servers in a binary, not a shell invocation. Require auth for any non-local MCP.

---

<a id="zizmor-rules"></a>

## 2. Zizmor rule catalog

Zizmor scans `.github/workflows/*.yml`. Top-severity rules:

| Rule                          | What it flags                                                                                                          | Default severity |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `unpinned-action`             | `uses: actions/checkout@v4` (tag — mutable) instead of `@<full-sha>`                                                   | HIGH             |
| `template-injection`          | `${{ github.event.issue.title }}` interpolated into a `run:` step without pre-validation                               | CRITICAL         |
| `excessive-permissions`       | `permissions: write-all` or `permissions: contents: write` when the job only reads                                     | HIGH             |
| `secret-in-env-at-step-level` | `env:` block at step level carrying a secret other jobs in the workflow can't see                                      | MEDIUM           |
| `pull-request-target-no-ref`  | `pull_request_target` trigger with no `ref:` — default checks out main, but the PR's code runs via an embedded command | CRITICAL         |
| `bash-at-step-level-no-shell` | `run:` without `shell: bash` — bash-specific syntax fails on Windows runners                                           | LOW              |
| `artifact-upload-secret`      | An action uploads artifacts from a path that may contain a secret                                                      | HIGH             |

**Fix**: pin every action SHA (use `# v4` trailing comment for human readability). For `template-injection`, stash the untrusted input in an env var first, then reference that env var in the shell:

```yaml
- name: Process title
  env:
    TITLE: ${{ github.event.issue.title }}
  run: |
    echo "title is: $TITLE"
```

Reduce `permissions` to the narrowest set that still lets the job function. `contents: read` is the right default for most jobs.

---

<a id="false-positives"></a>

## 3. Common false positives

Some findings look alarming but are benign. Know these before filing a fix PR.

### "Hardcoded token" in docs/CLAUDE.md

When CLAUDE.md enumerates _forbidden token prefixes_ (like the token-guard hook docs), AgentShield's pattern match finds those prefixes. That's a doc listing what to block, not a leaked token.

**Check**: if the match is in prose documenting the block list, it's a false positive.

**Resolution**: leave it (it's illustrative) or wrap the pattern in inline `<code>` blocks so AgentShield classifies it as content-not-value.

### "Unpinned action" on a reusable workflow call

Reusable workflows referenced via `uses: owner/repo/.github/workflows/file.yml@ref` — zizmor flags if `ref` isn't a full SHA. Same rule as for regular actions. Pin the SHA.

**Resolution**: pin the SHA with a trailing version comment.

### "Excessive permissions" on a workflow-level block

When the workflow declares `permissions: { contents: read }` at the top and each job tightens from there, zizmor may flag the _workflow-level_ permissions as excessive even if job-level blocks are correctly narrowed.

**Resolution**: workflow-level `contents: read` is already minimal. Suppress if noise.

### "Template injection" on `github.run_id` / `github.sha`

Trusted context fields (`github.run_id`, `github.sha`, `github.ref_name`) are zizmor-flagged because the rule doesn't distinguish trusted from untrusted context. They are safe to interpolate.

**Resolution**: use the zizmor ignore comment on the line above the interpolation:

```yaml
# zizmor: ignore[template-injection] trusted-field
```

### "Dotfile leak" for `.env.example`

`.env.example` is by convention a _template_ for developers — no real values. If AgentShield flags it, it's a false positive.

**Resolution**: rename to `.env.example.template` if AgentShield insists, or add a path-specific ignore.

---

<a id="severity-decisions"></a>

## 4. Severity decision tree

When triaging findings, decide whether to treat a finding at default severity or promote / demote.

```
 ┌─────────────────────────────────────────────────────────┐
 │ Does the finding expose a secret that's still valid?     │
 ├─────────────────────────────────────────────────────────┤
 │   YES → CRITICAL regardless of default severity.         │
 │          Rotate the secret first, then fix the code.     │
 │   NO  → proceed.                                          │
 └─────────────────────────────────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Can an attacker trigger this path without privileged     │
 │ access (e.g. via a PR, a webhook, a public API)?         │
 ├─────────────────────────────────────────────────────────┤
 │   YES → default severity or higher.                      │
 │   NO  → one step lower than default (requires insider).  │
 └─────────────────────────────────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────┐
 │ Does the finding block or degrade a safety mechanism?   │
 │ (allow list, hook, signature check, permission scope)   │
 ├─────────────────────────────────────────────────────────┤
 │   YES → default severity.                                │
 │   NO  → one step lower.                                  │
 └─────────────────────────────────────────────────────────┘
```

Resulting severity caps the grade per `_shared/report-format.md`.

---

<a id="fix-recipes"></a>

## 5. Fix recipes

Patterns for the most common findings.

### Unpinned action

Before:

```yaml
- uses: actions/checkout@v4
```

After:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

Find the SHA via:

```bash
gh api repos/actions/checkout/git/refs/tags/v4.2.2 --jq .object.sha
```

Pin to the SHA, trail with a human-readable comment.

### Template injection from issue / PR fields

Before:

```yaml
- name: Comment back
  run: |
    echo "Thanks for: ${{ github.event.issue.title }}"
```

After:

```yaml
- name: Comment back
  env:
    TITLE: ${{ github.event.issue.title }}
  run: |
    echo "Thanks for: $TITLE"
```

Shell-variable expansion happens inside bash with quoting rules you control; interpolation via `${{ … }}` happens before bash parses, so an adversary-controlled title could inject.

### Overly permissive `permissions:` block

Before:

```yaml
permissions:
  contents: write
```

After:

```yaml
permissions:
  contents: read
```

Only widen to `write` if the job actually pushes commits or releases.

### Hardcoded token in settings.json

Before:

```json
{
  "env": { "API_TOKEN": "<literal-token-here>" }
}
```

After:

```json
{
  "env": { "API_TOKEN": "${API_TOKEN}" }
}
```

Shell-style substitution reads from the environment at skill-run time; the literal token never lands in the repo.

---

<a id="skipping-checks"></a>

## 6. When to skip a check (and how)

Skipping a rule is sometimes correct — when the finding is a documented false positive, or when the rule's cost outweighs its value for this repo.

### AgentShield

Per-line suppression:

```
<!-- agentshield: ignore[rule-name] reason -->
```

Where `reason` is a one-line justification a reviewer can read in a diff. Avoid generic reasons like "false positive"; say _why_ it's a false positive.

### Zizmor

Per-line suppression:

```yaml
- uses: some/action@v1 # zizmor: ignore[unpinned-action] upstream has no tagged releases
```

Same rule: the reason must explain _why_, not just _that_.

### Blanket skip for a tool

If a tool is not installed locally, the SKILL.md phase skips it with a warning. This is correct for developer machines; CI must have the tool installed and skip-with-warning must not occur there. If you see a CI skip, fix the setup script.

---

<a id="reading-the-report"></a>

## 7. Reading the report

The report follows `_shared/report-format.md`:

```
=== HANDOFF: scanning-security ===
Status: fail
Grade: C
Findings: {critical: 0, high: 4, medium: 2, low: 0}
Summary: 4 high-severity zizmor findings — fix before release
=== END HANDOFF ===

- **[HIGH]** .github/workflows/ci.yml:60 — unpinned action
  Fix: pin to a full SHA; grab via `gh api`.

…
```

Read in this order:

1. **Grade + summary** at the top. If `A` or `B`, skim the rest for context. If `C` or below, every `CRITICAL` and `HIGH` is release-blocking.
2. **Critical findings.** Address every one.
3. **High findings.** Address unless you have an explicit suppression with a reason.
4. **Medium / Low.** Address if time permits; triage for a follow-up PR if not.

---

<a id="cross-references"></a>

## 8. Cross-references

- **SKILL.md** — the phased scan workflow.
- `.claude/skills/_shared/security-tools.md` — tool detection (AgentShield, zizmor) + install paths.
- `.claude/skills/_shared/report-format.md` — grade rubric + HANDOFF block format.
- `.claude/skills/_shared/env-check.md` — common environment prep.
- `.claude/agents/security-reviewer.md` — the agent that produces the final grade.
- [AgentShield docs](https://github.com/socketdev/agentshield) — upstream tool.
- [zizmor docs](https://woodruffw.github.io/zizmor/) — upstream tool.
