---
name: updating-pricing
description: Refresh current AI model pricing data from vendor sources and update fleet pricing constants.
user-invocable: true
allowed-tools: Skill, Read, Edit, WebFetch, Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
---

# updating-pricing

Re-sources the per-model token prices the fleet routes spend on, so the figure `scripts/fleet/estimate-ai-cost.mts` reports stays honest. Invoked directly via `/update-pricing` or as a phase of the `updating` umbrella. The snapshot date is restamped on every refresh, which is what keeps the freshness anchored to the weekly cadence rather than to a guessed timer.

## When to use

- As a phase of the weekly `updating` umbrella — this is the cadence the pricing refresh rides, not a bespoke timer.
- On demand when prices are known to have moved (a new model tier, a vendor price change) — `/update-pricing`.
- When `check --all` warns the pricing snapshot is stale (the `pricing-data-is-current` gate points here).

## What it does NOT do

- **Invent prices.** The numbers come off the vendor pricing page (or the researching-recency feed), read this run. If neither yields a price, the skill reports that and exits without writing — a stale-but-real snapshot beats a guessed one.
- **Commit private budgets.** `model-pricing.json` is GENERIC + PUBLIC: vendor list prices + the generic plan STRUCTURE (kind / constraint / public list price) only. An org's real budgets, usage, or subscription specifics live solely in private runtime config — never in this committed, cascaded file.
- **Re-derive the JSON shape in shell.** The write is owned by `scripts/fleet/update-model-pricing.mts` (the same owner pattern as `make-coverage-badge.mts`): the skill hands it sourced prices for one `--service`, the script stamps that service's date and writes canonically. The skill never hand-edits the JSON.
- **Change the multipliers or the model set.** A routine refresh touches per-model rates only. Adding a model/service or changing a discount multiplier (batch / cache) is a deliberate edit to the data file, not a price refresh.
- **Touch the cost model.** `estimate-ai-cost.mts`'s math is fixed; this skill only refreshes its input data.

## Phases

| #   | Phase     | Outcome                                                                                              |
| --- | --------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Read current | `node scripts/fleet/update-model-pricing.mts --check` — print each service's snapshot + priced models. |
| 2   | Source    | Per service: WebFetch its `pricingSource`; if a number isn't directly available, mine the feed with `node scripts/fleet/source-pricing-feed.mts --service <id>` and read it off the evidence envelope. |
| 3   | Write     | `node scripts/fleet/update-model-pricing.mts --service <id> --prices '<json>'` — restamps that service's snapshot + the doc marker. |
| 4   | Commit    | `chore(pricing): refresh <service> pricing snapshot to <date>`. Direct-push per fleet norm.          |

The snapshot/date/shape logic is owned by `scripts/fleet/update-model-pricing.mts` and reads the current data via `loadPricing()` from `scripts/fleet/estimate-ai-cost.mts` — the same loader the estimator and the `pricing-data-is-current` gate share. Pricing is per-service: each service stamps its own snapshot, so a refresh targets one `--service`. This skill is orchestration over those scripts; the judgment it keeps is reading the prices correctly and surfacing a fetch failure rather than writing a guess.

## Phase 1: read current

```sh
node scripts/fleet/update-model-pricing.mts --check
```

Prints each service's `snapshot` date, `pricingSource` URL, and priced model ids. No write. Use this to see the before-state and confirm which service + models need a price read.

## Phase 2: source

For the service you're refreshing, WebFetch its `pricingSource` URL (the `--check` run printed it). Read off, for each model id already in that service, the input and output price in USD per million tokens (MTok). Price only the ids that exist — a new model/service is a deliberate add, not part of a refresh.

When a number isn't directly available (the page moved, is gated, or a price just changed and the doc lags), mine the multi-source feed:

```sh
node scripts/fleet/source-pricing-feed.mts --service <id>
```

It runs the `researching-recency` engine with a pricing-tuned plan and prints a compact evidence envelope (recent pricing announcements across web / hackernews / lobsters / reddit). Read the current prices off the envelope, cross-checking against the service's `pricingSource`.

If neither the page nor the feed yields a price, STOP: report the failure and the last-known snapshot, and do not write. A stale real snapshot is safer than a hallucinated price.

## Phase 3: write

```sh
node scripts/fleet/update-model-pricing.mts --service anthropic --prices '{"claude-haiku-4-5":{"inputPerMtok":1.0,"outputPerMtok":5.0},"claude-sonnet-4-6":{"inputPerMtok":3.0,"outputPerMtok":15.0}}'
```

Pass the prices read in Phase 2 as a JSON object keyed by model id, with `--service <id>` (default `anthropic`) naming which service they belong to. The script stamps that service's `snapshot` to today, writes `scripts/fleet/constants/model-pricing.json` canonically (preserving each model's other fields — contextWindow / billing / suspended), and restamps the combined `MODEL-PRICING-SNAPSHOT` marker in `docs/agents.md/fleet/skill-model-routing.md`. Models you omit keep their current rates (a partial refresh never drops a model). Override that service's recorded `pricingSource` with `--source <url>` if the vendor URL changed.

## Phase 4: commit

```sh
git add scripts/fleet/constants/model-pricing.json docs/agents.md/fleet/skill-model-routing.md
git commit -m "chore(pricing): refresh <service> pricing snapshot to <date>"
git push origin <default-branch>
```

Direct-push per the fleet's `Commits & PRs → Push policy` rule; fall back to PR if the remote rejects. In the wheelhouse, edit `template/base/` and cascade — the live `scripts/fleet/` + `docs/` copies are cascade-derived.

## Output

When called via `/update-pricing`, emit a one-line summary: the service refreshed, its snapshot date before → after, and which models were re-priced. When neither the page nor the feed yields a price (or nothing moved), say so and exit without committing.

## Related

- `.claude/skills/updating/SKILL.md`: umbrella that calls this skill as its pricing phase.
- `.claude/skills/researching-recency/SKILL.md`: the broader recency-research skill `source-pricing-feed.mts` builds on; use it directly when a refresh needs more than a single provider page.
- `scripts/fleet/source-pricing-feed.mts`: the feed-sourcing fallback — runs the recency engine with a per-service pricing plan when a vendor number isn't directly fetchable.
- `scripts/fleet/estimate-ai-cost.mts`: consumes `model-pricing.json` to compute run costs.
- `scripts/fleet/check/pricing-data-is-current.mts`: the per-service staleness gate that points here.
