# researching-recency reference

## Contents

- Query plan JSON schema
- Per-source query recipes
- Opt-in source setup
- Engine flags

## Query plan JSON schema

The model builds this and passes it via `--plan <path|json>`. The engine validates it (see `lib/plan.mts`) and rejects malformed plans with a fix-it message.

```jsonc
{
  "intent": "comparison",          // free-form hint: overview | comparison | howTo | …
  "freshnessMode": "balancedRecent", // strictRecent | balancedRecent | evergreenOk
  "sourceWeights": { "github": 1.5 }, // optional per-source multipliers
  "notes": ["peer set: esbuild, rspack"], // optional, surfaced for your synthesis
  "xHandles": { "allowed": ["youyuxi", "patak_dev"] }, // optional, see below
  "subqueries": [
    {
      "label": "core",             // unique slug, NO spaces (keys the fusion stream)
      "searchQuery": "rolldown",   // what each source searches for
      "rankingQuery": "rolldown bundler", // optional; what items are scored against (defaults to searchQuery)
      "sources": ["github", "hackernews", "reddit", "lobsters", "devto"],
      "weight": 1.0                // optional, > 0, defaults to 1
    },
    {
      "label": "vs-esbuild",
      "searchQuery": "rolldown vs esbuild",
      "sources": ["hackernews", "reddit"],
      "weight": 0.7
    }
  ]
}
```

A bare topic with no `--plan` gets a default single-subquery plan over every keyless source.

### Scoping X to specific handles

When the plan includes the `x` source, `xHandles` scopes the X search to accounts (the xAI `x_search` tool's `allowed_x_handles` / `excluded_x_handles`, max 20 each, mutually exclusive):

- `"xHandles": { "allowed": ["youyuxi", "patak_dev"] }` — **allowlist**: only posts from these handles. Use to read what a project's maintainers are saying.
- `"xHandles": { "excluded": ["noisy_bot"] }` — **denylist**: all of X except these handles. Use to mute an aggregator or spam account drowning the signal.

Handles are bare (a leading `@` is stripped). Passing both `allowed` and `excluded` is rejected — the API accepts only one.

When the `x` source runs with **no** `xHandles` in the plan, the engine seeds the allowlist with `DEFAULT_DEV_HANDLES` (a vetted set of tool-author + dev-news accounts in `lib/sources/x.mts`) so an unscoped X search still favors high-signal voices. An explicit plan `xHandles` always overrides the default — set `allowed` to your own follows to tune it, or `excluded` to opt out of the default scoping and search all of X minus a few accounts.

## Per-source query recipes

- **GitHub** — searches issues + PRs created in the window, sorted by reactions. Authenticated via `GITHUB_TOKEN`/`GH_TOKEN` or `gh auth token`; falls back to unauthenticated (10 req/min). Phrase the `searchQuery` as GitHub search syntax works: bare terms match title + body. Use `--github-repo owner/repo` style targeting by putting `repo:owner/name` in the `searchQuery` if you want one project.
- **Hacker News** — Algolia full-text over stories with a small points floor. The `searchQuery` is matched against titles; keep it to the entity name plus one qualifier.
- **Reddit** — keyless Atom RSS search across the default programming subs (`programming`, `ExperiencedDevs`, `webdev`). The `.json` API 403s from datacenter IPs, so RSS is the load-bearing path; it carries no score/comment counts, so Reddit items rank on relevance + freshness.
- **Lobsters / dev.to** — neither has full-text search, so the query maps to a tag feed (`rust`, `javascript`, `programming`, …). A query token that matches a known tag hits that feed; otherwise the broad `programming` feed. Best for ecosystem/language topics, weak for a specific library name.
- **Web** — you run `WebSearch`, write the hits to a JSON file, and pass `--web-file`. Shape: a bare array `[{title, url, snippet, publishedAt, source}]` or `{ "hits": [...] }`. Entries with no `url` are dropped.

## Opt-in source setup

Both opt-in sources read their credential from a process env var, populated from the OS keychain at session start. The engine never reads the keychain on the hot path (a per-call keychain read triggers a UI prompt and is blocked by `no-blind-keychain-read-guard`); it only reads `process.env`.

### X / Twitter (xAI)

X carries the earliest dev signal — maintainers post breaking changes and hot takes there first. The adapter uses the **xAI Responses API** with the native `x_search` tool: Grok searches X over the date window and returns structured posts. That's a single bearer token, not browser-cookie scraping.

1. **Get a key.** Create an xAI API key at [console.x.ai](https://console.x.ai) (the key looks like `xai-…`). X search via the `x_search` tool is a paid feature — check your account's model entitlement.
2. **Store it in the keychain** (write is allowed; reads on the hot path are not):

   ```bash
   # macOS
   security add-generic-password -a "$USER" -s XAI_API_KEY -w "xai-…"
   # Linux (libsecret)
   secret-tool store --label=XAI_API_KEY service XAI_API_KEY
   ```

3. **Load it into the session env.** Your shell/session startup should export it so the engine sees `process.env.XAI_API_KEY` — the same way `SOCKET_API_KEY` is loaded. For a one-off run you can also export it inline:

   ```bash
   export XAI_API_KEY="$(security find-generic-password -a "$USER" -s XAI_API_KEY -w)"  # operator shell only
   node scripts/fleet/researching-recency/cli.mts "rolldown" --search=x,github,hackernews
   ```

   (Optional: `XAI_MODEL` overrides the default `grok-4`.)

Absent `XAI_API_KEY`, X is skipped with a note and the other sources carry the run. `x` is opt-in, so it's never in the default-plan source set — name it explicitly via `--search=x,…` or in a plan subquery's `sources`.

### Bluesky

Create a free app password at bsky.app → Settings → App Passwords. Set `BSKY_HANDLE` (e.g. `you.bsky.social`) and `BSKY_APP_PASSWORD` (keychain → session env, same pattern as above). The adapter authenticates per run; absent either var, Bluesky is skipped with a note. Never put these in a dotfile — env var or OS keychain only.

## Engine flags

| Flag | Meaning |
|------|---------|
| `<topic>` | First positional — the research topic (required) |
| `--emit=compact` | Output format (required by this skill; the only supported mode) |
| `--days=30` | Look-back window in days |
| `--depth=quick\|default\|deep` | Per-stream + pool sizes (latency vs recall) |
| `--search=a,b,c` | Restrict to named sources |
| `--plan <path\|json>` | Query plan (file path or inline JSON) |
| `--web-file <path>` | JSON file of your WebSearch hits |
| `--save-dir <dir>` | Where the raw brief is saved (defaults under `.claude/reports/`) |

The raw brief is saved to `--save-dir` (untracked) and its path is echoed in the footer.
