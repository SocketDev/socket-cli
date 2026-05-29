# no-token-in-dotenv-guard

`PreToolUse(Edit|Write)` blocker that refuses writing a real API token / secret into a `.env` / `.env.local` / `.env.<anything>` / `.envrc` dotfile.

## Why

Dotfiles leak. They:

- Get accidentally committed despite `.gitignore` (one careless `git add -A` and the file's in history).
- Get read by every dev tool that walks the project dir.
- Get swept by file-indexer / backup / log-scraper clients (Spotlight, Time Machine, Dropbox, etc.).
- End up in shell-history dotfile dumps that the operator shares.

Tokens belong in **env vars** (CI) or the **OS keychain** (dev local). Never in a file.

## Detection

A hit requires all of:

1. **File path** ends in `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.<anything>`, or `.envrc`.
2. **A line** of the form `<KEY>=<value>` where `<KEY>` matches either a known token-bearing name (sourced from [`_shared/token-patterns.mts`](../_shared/token-patterns.mts)) or the generic `*_(?:TOKEN|KEY|SECRET)` suffix shape.
3. **The value is non-empty** and isn't a known placeholder (`<your-token>`, `xxx`, `TODO`, `REPLACE-ME`, `${SECRET}`, `$(...)`).

The shared catalog covers Socket fleet, LLM providers (Anthropic, OpenAI, Gemini, etc.), VCS (GitHub, GitLab), product tracking (Linear, Notion, Jira, Asana, Trello), chat (Slack, Discord, Telegram, Twilio), cloud (AWS, GCP, Azure, DO, Cloudflare, Fly, Heroku), package registries, payments (Stripe, Square, PayPal), email (SendGrid, Mailgun, etc.), and observability (Datadog, Sentry, etc.).

## Bypass

`Allow dotenv-token bypass` in a recent user turn. Use case: seeding a test fixture's `.env` with a known-junk token that's structurally valid but not authoritative.

## Source of truth

The rule lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Token hygiene". This hook enforces it at edit time alongside [`token-guard`](../token-guard/) (which enforces the same rule at Bash time).
