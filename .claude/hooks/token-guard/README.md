# token-guard

Claude Code `PreToolUse` hook that refuses Bash tool calls that would leak secrets to tool output. Mandatory across the Socket fleet — every repo ships this file byte-for-byte via `scripts/sync-scaffolding.mjs`.

## What it blocks

| Rule | Example | Fix |
|------|---------|-----|
| Literal token in command | `echo vtwn_abc123…` | Rotate the exposed token; read tokens from `.env.local` at spawn time, never inline them |
| `env`/`printenv`/`export -p`/`set` dumping everything | `env \| grep FOO` (unredacted) | `env \| sed 's/=.*/=<redacted>/'` or filter specific keys |
| `.env*` read without redactor | `cat .env.local` | `sed 's/=.*/=<redacted>/' .env.local` or `grep -v '^#' .env.local \| cut -d= -f1` |
| `curl -H "Authorization:"` with unfiltered stdout | `curl -H "Authorization: Bearer $TOKEN" api.example.com` | Redirect to file/`/dev/null`, or pipe to `jq`/`grep`/`head`/`wc`/`cut`/`awk` |
| References sensitive env var name writing unredacted to stdout | `echo $API_KEY` | Same as above |

## What it allows

- Any write to a file (`>`, `>>`, `tee`)
- Any pipe through `jq`, `grep`, `head`, `tail`, `wc`, `cut`, `awk`, `sed s/=.*/=<redacted>/`, `python3 -m json.tool`
- Legitimate `git`/`pnpm`/`npm`/`node`/`tsc`/`oxfmt`/`oxlint` invocations that happen to reference env var names but don't echo values
- Any curl call that does not carry an `Authorization:` header

## Detected token shapes

Literal value patterns caught in-command:

- Val Town — `vtwn_`
- Linear — `lin_api_`
- OpenAI / Anthropic — `sk-` (20+ chars)
- Stripe — `sk_live_`, `sk_test_`, `pk_live_`, `rk_live_`
- GitHub — `ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_`, `github_pat_`
- GitLab — `glpat-`
- AWS — `AKIA…`
- Slack — `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-`
- Google — `AIza…`
- JWTs — three-segment `eyJ…`

## Control flow

The hook reads the tool-use payload from stdin, type-checks `tool_name === 'Bash'`, and runs `check(command)`. Any rule violation `throw`s a typed `BlockError`; a single top-level `try/catch` in `main()` writes the block message to stderr and sets `process.exitCode = 2`. Hook bugs fail **open** — a crash in the hook writes a log line and returns exit 0 so legitimate work isn't blocked on a bad deploy.

## Testing

```bash
pnpm --filter hook-token-guard test
```

Adding new token-shape detections: update `LITERAL_TOKEN_PATTERNS` in `index.mts`, add a positive and negative test in `test/token-guard.test.mts`.

## Updating across the fleet

This file is in `IDENTICAL_FILES` in `scripts/sync-scaffolding.mjs`. After editing, run from `socket-repo-template`:

```bash
node scripts/sync-scaffolding.mjs --all --fix
```

to propagate the change to every fleet repo.
