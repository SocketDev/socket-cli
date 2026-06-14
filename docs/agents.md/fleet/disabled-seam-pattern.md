# disabled-seam-pattern

## What

Keep the **wire-in point** (the seam where a future capability slots in) present in the code, but gate the **behavior** behind a flag defaulted off. Never delete the seam; never hard-wire the behavior on.

## Why

A deleted extension point forces every future change to re-discover and re-thread the same plumbing through all call sites — the cost compounds with each layer that must be reopened.

A hard-wired-on capability that nobody consumes is live attack surface. Every unconditional side-effect (an emitted env var, an unconditional network call, an always-on credential check) is a manipulation point that can be targeted before there is a consumer to justify the exposure.

Gating the behavior off by default removes it as active surface while keeping the seam cheap to re-enable. The cost of the flag is negligible; the cost of re-threading is not.

## How to apply

**When tempted to delete an unused extension point:** gate it off instead. Wrap the behavior in a flag defaulted `false`; leave the call site intact. The seam stays threaded; the behavior is inert.

**When adding a new capability that has no consumers yet:** gate it off rather than emitting or running it unconditionally. Do not ship live surface to earn a future use case.

**Env vars that influence execution are manipulation points.** Prefer gating them behind a flag (so they are never read unless the flag is on) over deleting the mechanism. Fewer unconditional reads = smaller manipulation surface.

**Layered resolvers:** name the seam explicitly so future layers slot between existing steps without call-site churn. A credential resolver with a named seam between the env check and the keychain read lets a future layer insert there without touching callers.

**Note:** gating behavior off is not weakening a trust gate — it removes surface while preserving the mechanism. These are distinct operations.

## Enforcement

No automated enforcer today — this is a design-time discipline. Apply during code review, plan review (see `.claude/hooks/fleet/plan-review-reminder/`), and threat modeling.

Related: [`code-style.md`](code-style.md), [`prompt-injection.md`](prompt-injection.md), [`token-hygiene.md`](token-hygiene.md).
