# Token spend: match model + effort to the job

Mechanical, deterministic work runs on a cheap/fast model at low or medium effort. That covers wheelhouse→fleet cascades, lint-autofix, rename/path migrations, and dumb-bit propagation generally. Reserve `opus` plus `high`/`xhigh`/`max` for the work that needs it: architecture, hard debugging, security review, anything with real judgment or wide blast radius.

The `token-spend-guard` hook nudges when a mechanical command (a cascade, an autofix sweep, a bulk rename) runs on a premium model or high effort. Treat the nudge as a signal to drop down a tier before continuing.

Bypass when the premium tier is genuinely warranted for something that only looks mechanical (e.g. a rename that's actually a risky refactor): type `Allow model bypass` or `Allow effort bypass` verbatim in a recent turn.

Enforced by `.claude/hooks/fleet/token-spend-guard/`.
