---
name: fleet-updating-pricing
description: Refresh the fleet's model-pricing data by reading current per-model prices off the vendor pricing page and rewriting `scripts/fleet/constants/model-pricing.json` (and the routing-doc snapshot marker) with today's date. Sibling of `updating-coverage` / `updating-security` / `updating-lockstep` under the `updating` umbrella; the source of the numbers the AI cost estimator computes against.
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

- **Invent prices.** The numbers come off the vendor pricing page, read this run. If the page can't be reached, the skill reports that and exits without writing — a stale-but-real snapshot beats a guessed one.
- **Re-derive the JSON shape in shell.** The write is owned by `scripts/fleet/update-model-pricing.mts` (the same owner pattern as `make-coverage-badge.mts`): the skill hands it sourced prices, the script stamps the date and writes canonically. The skill never hand-edits the JSON.
- **Change the multipliers or the model set.** A routine refresh touches per-model rates only. Adding a model or changing a discount multiplier (batch / cache) is a deliberate edit to the data file, not a price refresh.
- **Touch the cost model.** `estimate-ai-cost.mts`'s math is fixed; this skill only refreshes its input data.

## Phases

| #   | Phase     | Outcome                                                                                              |
| --- | --------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Read current | `node scripts/fleet/update-model-pricing.mts --check` — print the on-disk snapshot + the priced models. |
| 2   | Source    | WebFetch the vendor pricing page; read off per-model input/output USD-per-MTok for the fleet's models. |
| 3   | Write     | `node scripts/fleet/update-model-pricing.mts --prices '<json>'` — restamps the snapshot + the doc marker. |
| 4   | Commit    | `chore(pricing): refresh model-pricing snapshot to <date>`. Direct-push per fleet norm.              |

The snapshot/date/shape logic is owned by `scripts/fleet/update-model-pricing.mts` and reads the current data via `loadPricing()` from `scripts/fleet/estimate-ai-cost.mts` — the same loader the estimator and the `pricing-data-is-current` gate share. This skill is orchestration over that script; the judgment it keeps is reading the vendor page correctly and surfacing a fetch failure rather than writing a guess.

## Phase 1: read current

```sh
node scripts/fleet/update-model-pricing.mts --check
```

Prints the current `snapshot` date, `source` URL, and the list of priced model ids. No write. Use this to see the before-state and confirm which models need a price read.

## Phase 2: source

WebFetch the `source` URL the `--check` run printed (the vendor pricing page). Read off, for each model id already in the data, the input and output price in USD per million tokens (MTok). The fleet's models are Claude tiers (haiku / sonnet / opus / fable / mythos); price only the ids that exist in the data — a new tier is a deliberate add, not part of a refresh.

If the page can't be fetched (network blocked, page moved), STOP: report the failure and the last-known snapshot, and do not write. A stale real snapshot is safer than a hallucinated price.

## Phase 3: write

```sh
node scripts/fleet/update-model-pricing.mts --prices '{"claude-haiku-4-5":{"inputPerMtok":1.0,"outputPerMtok":5.0},"claude-sonnet-4-6":{"inputPerMtok":3.0,"outputPerMtok":15.0}}'
```

Pass the prices read in Phase 2 as a JSON object keyed by model id. The script stamps the `snapshot` to today, writes `scripts/fleet/constants/model-pricing.json` canonically, and restamps the `MODEL-PRICING-SNAPSHOT` marker in `docs/agents.md/fleet/skill-model-routing.md` to match. Models you omit keep their current rates (a partial refresh never drops a model). Override the recorded source with `--source <url>` if the vendor URL changed.

## Phase 4: commit

```sh
git add scripts/fleet/constants/model-pricing.json docs/agents.md/fleet/skill-model-routing.md
git commit -m "chore(pricing): refresh model-pricing snapshot to <date>"
git push origin <default-branch>
```

Direct-push per the fleet's `Commits & PRs → Push policy` rule; fall back to PR if the remote rejects. In the wheelhouse, edit `template/` and cascade — the live `scripts/fleet/` + `docs/` copies are cascade-derived.

## Output

When called via `/update-pricing`, emit a one-line summary: the snapshot date before → after and which models were re-priced. When the page can't be fetched or no price moved, say so and exit without committing.

## Related

- `.claude/skills/updating/SKILL.md`: umbrella that calls this skill as its pricing phase.
- `.claude/skills/researching-recency/SKILL.md`: the broader recency-research skill; use it when a refresh needs more than the vendor page (subscription limits, competitor rates, the cost-ladder report).
- `scripts/fleet/estimate-ai-cost.mts`: consumes `model-pricing.json` to compute run costs.
- `scripts/fleet/check/pricing-data-is-current.mts`: the staleness gate that points here.
