---
description: Scan a repo for disciplines enforced only by prose, convention, or agent memory and codify each into a script, hook, lint rule, or CLAUDE.md rule. Code is law — memory and docs don't enforce. Runs a Workflow of scanner agents, ranks gaps by blast radius, and proposes a concrete codification per gap.
---

Run the `codifying-disciplines` skill.

Finds the disciplines a repo relies on but doesn't enforce (CLAUDE.md rules with
no enforcer, repeated review feedback, build/release steps that depend on
someone remembering, doc conventions with no validator) and turns each into
executable law. Especially load-bearing for build and release steps. Interactive
by default — confirms scope and which proposed codifications to apply now;
non-interactive mode reports without applying.
