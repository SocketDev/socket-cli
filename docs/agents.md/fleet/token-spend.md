# Token spend: match model + effort to the job

Mechanical, deterministic work runs on a cheap/fast model at low or medium effort. That covers wheelhouse→fleet cascades, lint-autofix, rename/path migrations, and dumb-bit propagation generally. Reserve `opus` plus `high`/`xhigh`/`max` for the work that needs it: architecture, hard debugging, security review, anything with real judgment or wide blast radius.

The `token-spend-guard` hook nudges when a mechanical command (a cascade, an autofix sweep, a bulk rename) runs on a premium model or high effort. Treat the nudge as a signal to drop down a tier before continuing.

## The effort dial

Effort and model are separate dials. The effort dial (`low`/`medium`/`high`/`xhigh`/`max`) sets how much the model is willing to spend, not how capable it is. Thinking is adaptive: below `max` the model ignores budget it does not need, so wall-clock barely moves across `low`→`xhigh` on a task that does not warrant the spend. `max` is the only level that forces full spend, and that extra spend buys re-verification, not better answers — on a benchmark where every level returned correct results, the higher levels spent their seconds double-checking work the lower levels had already gotten right.

So default to `high` for judgment work and reserve `max` as a rare exception for when you specifically want the model to audit its own answer (a risky migration, a correctness-critical patch). Routine and mechanical work stays at `low`/`medium`. Picking `max` to chase correctness is the common mistake — it buys you a second pass over the same answer, not a better one.

Bypass when the premium tier is genuinely warranted for something that only looks mechanical (e.g. a rename that's actually a risky refactor): type `Allow model bypass` or `Allow effort bypass` verbatim in a recent turn.

Enforced by `.claude/hooks/fleet/token-spend-guard/`.
