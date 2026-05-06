# token-guard

A **Claude Code hook** that runs before every Bash command and
**blocks** the call if the command shape would leak a secret (an API
key, an OAuth token, a JWT, etc.) into Claude's view of stdout.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool. It can either
> **prime** (write to stderr, exit 0, model carries on) or **block**
> (exit 2, command never runs). This one blocks. The model then sees
> the block reason and rewrites the command.

## Why this exists

Claude reads tool output back into its context. If a `cat .env`
prints `STRIPE_KEY=sk_live_…`, the secret is now in conversation
history and could be echoed into a commit, a PR, or a chat reply
later. The cleanest fix is to never print the value at all.

## What it blocks

| Rule | Example that gets blocked | What to do instead |
|------|--------------------------|--------------------|
| Literal token in the command itself | `echo vtwn_abc123…` | Rotate the exposed token; read tokens from `.env.local` at spawn time, never inline them. |
| `env` / `printenv` / `export -p` / `set` printing everything | `env \| grep FOO` (the grep doesn't redact the value) | `env \| sed 's/=.*/=<redacted>/'`, or filter specific keys you know aren't secret. |
| `.env*` read without a redactor | `cat .env.local` | `sed 's/=.*/=<redacted>/' .env.local`, or just print key names: `grep -v '^#' .env.local \| cut -d= -f1`. |
| `curl -H "Authorization:"` with unfiltered stdout | `curl -H "Authorization: Bearer $TOKEN" api.example.com` | Redirect output (`> file`, `> /dev/null`), or pipe through `jq` / `grep` / `head` / `wc` / `cut` / `awk` so the response body is processed before it hits Claude's stdout. |
| Sensitive env var name in an `echo` / `printf` to stdout | `echo $API_KEY` | Same as above — redirect or pipe. |

## What it allows

- Any write to a file (`>`, `>>`, `tee`).
- Any pipe through `jq`, `grep`, `head`, `tail`, `wc`, `cut`, `awk`,
  `sed s/=.*/=<redacted>/`, `python3 -m json.tool`.
- Legitimate `git` / `pnpm` / `npm` / `node` / `tsc` / `oxfmt` /
  `oxlint` invocations that happen to reference env var names but
  don't echo values.
- Any `curl` call that does not carry an `Authorization:` header.

## Detected token shapes

If a literal value matching one of these prefixes appears in a Bash
command, it gets blocked outright (the assumption being that a value
this shape is not idle text):

| Provider | Prefix |
|---|---|
| Val Town | `vtwn_` |
| Linear | `lin_api_` |
| OpenAI / Anthropic | `sk-` (20+ chars) |
| Stripe | `sk_live_`, `sk_test_`, `pk_live_`, `rk_live_` |
| GitHub | `ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_`, `github_pat_` |
| GitLab | `glpat-` |
| AWS | `AKIA…` |
| Slack | `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-` |
| Google | `AIza…` |
| JWTs | three-segment `eyJ…` |

## Fail-open on hook bugs

If the hook itself crashes (a parse error, a missing dep, a typo in
a regex), it writes a log line and exits `0` — i.e. *the command is
allowed*. The reasoning: a buggy security hook that blocks
everything is a worse outcome than a buggy security hook that
temporarily lets things through. The companion enforcement layers
(`pre-push` git hook, secret scanners in CI) catch what slips past.

## Testing

```bash
pnpm --filter hook-token-guard test
```

Adding a new token-shape detection: add an entry to
`LITERAL_TOKEN_PATTERNS` in `index.mts`, then add a positive and a
negative test in `test/token-guard.test.mts`.

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/token-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.

To propagate a change from the template to every fleet repo:

```bash
node scripts/sync-scaffolding.mts --all --fix
```
