# researching-recency

A programming-tailored "what is the community actually saying in the last 30 days" research skill, ported from the open-source `last30days-skill` and trimmed to developer sources. The skill orchestrates; a deterministic `.mts` engine does the fetch/score/rank.

## Why it exists

A README reflects the maintainer's intent; a training cutoff reflects last year. Neither tells you what users hit *this month*: the regression everyone's filing, the migration that broke, the tool the community quietly moved to. This skill pulls that recent signal from where developers actually talk (GitHub issues, Hacker News, programming subreddits, Lobsters, dev.to) and ranks it by real engagement (stars, points, upvotes, reactions) instead of SEO.

## Architecture

Two halves, by design (the Anthropic Agent-Skills best-practices split):

- **Deterministic engine** (`scripts/fleet/researching-recency/`): the math that must be repeatable. Parallel fetch, freshness + engagement scoring, near-duplicate collapse, reciprocal-rank fusion, and rendering the evidence envelope. Pure, unit-tested, no model in the loop.
- **Model-driven synthesis** (the `SKILL.md` contract): the judgment. Resolving the entity, building the query plan, clustering the evidence into themes, and writing the cited prose. The engine drops the LLM reranker the upstream uses, and the model recovers that judgment at synthesis time.

### Engine pipeline

`plan` then `fetch` (parallel, capped) then `annotate` (signals) then `dedupe` then reciprocal-rank `fuse` then `render`.

- `lib/plan.mts` validates the model-supplied query plan; a bare topic defaults to one subquery over the keyless sources.
- `lib/fetch.mts` fans out one job per (subquery, source), caps concurrency (sources rate-limit), annotates each stream with local scores, drops sub-floor-relevance noise, and returns streams keyed by `streamKeyOf(label, source)`.
- `lib/signals.mts` and `lib/relevance.mts` carry freshness decay, per-source engagement weights, and token-overlap relevance with programming synonym groups (js/javascript, ts/typescript, and so on). Ported coefficient-for-coefficient from the upstream `signals.py` and `relevance.py`.
- `lib/dedupe.mts` does trigram + token Jaccard near-duplicate collapse (from `dedupe.py`).
- `lib/rank.mts` does weighted reciprocal-rank fusion, a per-author cap, source diversity, and URL canonicalization (from `fusion.py`). The stream-key format lives only in `streamKeyOf`/`parseStreamKey`.
- `lib/render/` emits the `--emit=compact` badge, evidence envelope, and pass-through footer, using the marker constants in `lib/markers.mts`.

## Sources

| Source | Auth | Notes |
|--------|------|-------|
| GitHub | `gh auth token` / `GITHUB_TOKEN`, else unauthenticated | issues + PRs, sorted by reactions |
| Hacker News | none | Algolia full-text, points floor |
| Reddit | none | Atom RSS search (the `.json` path 403s); no engagement counts |
| Lobsters | none | per-tag feed (no full-text search) |
| dev.to | none | per-tag feed (Forem API) |
| X / Twitter | `XAI_API_KEY` | opt-in; xAI Responses API with the `x_search` tool (Grok), not cookie scraping; skipped with a note when unset |
| Bluesky | `BSKY_HANDLE` + `BSKY_APP_PASSWORD` | opt-in; skipped with a note when unset |
| web | model-fed via `--web-file` | the model runs WebSearch and passes the hits |

The opt-in sources (X, Bluesky) read their credential from a process env var loaded from the OS keychain at session start; the engine never reads the keychain on the hot path. X uses the xAI Grok `x_search` path rather than the upstream's fragile cookie-driven GraphQL scraper, so it's a single bearer token with no scraping fragility. Keychain setup is documented in the skill's reference.md.

## Contract enforcement

The SKILL.md prose and the engine output share literal marker strings (the badge prefix, the evidence-envelope and footer comment fences). Those live once in `lib/markers.mts`. The `researching-recency-contract-is-current` check imports them and asserts the SKILL.md still quotes them, so the prose contract can't silently drift from what the engine emits.

## Tests

`test/unit/fleet/researching-recency-*.test.mts` cover every pure module (relevance, signals, dedupe, rank, plan, render) directly, and every source adapter against `nock`-mocked fixtures that mirror the real API shapes, under `disableNetConnect()`.
