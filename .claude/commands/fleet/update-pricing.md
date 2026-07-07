---
description: Refresh the fleet's model-pricing data from the vendor page via the updating-pricing skill.
---

Read current per-model token prices off the vendor pricing page, rewrite `scripts/fleet/constants/model-pricing.json`, and restamp the `MODEL-PRICING-SNAPSHOT` marker in the routing doc — both with today's date. The snapshot restamp is what keeps pricing freshness anchored to the weekly cadence rather than a guessed timer.

Use as a phase of the weekly `updating` umbrella, on demand when prices move, or when `check --all` warns the pricing snapshot is stale. Exits without writing if the vendor page can't be fetched (a stale real snapshot beats a guessed price). In the wheelhouse, edit `template/` and cascade — the live copies are cascade-derived.

Invokes the `updating-pricing` skill.
