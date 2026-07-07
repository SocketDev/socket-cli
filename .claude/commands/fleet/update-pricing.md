---
description: Refresh the fleet's model-pricing data from the vendor page via the updating-pricing skill.
---

Read current per-model token prices off a provider's vendor pricing page (or, when a number isn't directly available, the researching-recency feed), rewrite that service in `scripts/fleet/constants/model-pricing.json`, and restamp the `MODEL-PRICING-SNAPSHOT` marker in the routing doc with today's date. Pricing is per-service — each service stamps its own snapshot — so a refresh targets one `--service`. The snapshot restamp keeps pricing freshness anchored to the weekly cadence rather than a guessed timer. The data is GENERIC + PUBLIC (vendor list prices + generic plan structure only); private budgets never enter it.

Use as a phase of the weekly `updating` umbrella, on demand when prices move, or when `check --all` warns a service's pricing snapshot is stale. Exits without writing if neither the vendor page nor the feed yields a price (a stale real snapshot beats a guessed price). In the wheelhouse, edit `template/base/` and cascade — the live copies are cascade-derived.

Invokes the `updating-pricing` skill.
