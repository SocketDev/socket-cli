---
description: Read-only DRY/KISS sweep of the fleet hook tree + oxlint plugin; writes a consolidation plan to .claude/reports/ via the updating-hooks-dry skill.
---

Scan `.claude/hooks/fleet/**` and `.config/fleet/oxlint-plugin/fleet/**` for bloat: copy-paste clusters that should share a `_shared/` helper, dead `_shared/` exports, overlapping guards / redundant lint rules, and KISS smells — a hook far longer than its siblings, raw regex where the shared AST parser exists. Ranks findings by leverage and writes a report to `.claude/reports/hooks-dry-sweep-<date>.md` with evidence + a concrete consolidation sketch per cluster.

**Plan-only**: applies nothing, opens no PR — a human (or a follow-up `refactor-cleaner`) executes from the report. The mechanical, safe slice (dead `_shared/` exports) is already a `check --all` gate; this is the broader advisory sweep.

Use periodically, or after `codifying-disciplines` lands a burst of new hooks and the tree feels repetitive.

Invokes the `updating-hooks-dry` skill.
