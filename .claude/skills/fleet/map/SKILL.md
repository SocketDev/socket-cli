---
name: map
description: Emit a token-cheap symbol map for files or directories before reading unfamiliar source in detail.
user-invocable: true
allowed-tools: Read, Bash(node scripts/fleet/gen/repo-map.mts:*)
---

# map

<task>
Produce a symbol skeleton for the given path(s) and use it to navigate, instead
of reading whole files. The skeleton lists each top-level symbol with its line
span (`Lstart-Lend  <signature>`); read only the span whose body you actually
need.
</task>

<procedure>
1. Run the engine on the path argument(s):

   ```
   node scripts/fleet/gen/repo-map.mts <file|dir> [<file|dir>…]
   ```

   Skeleton lines go to stdout; a `source → skeleton` savings summary goes to
   stderr.

2. Read the skeleton to locate the symbol you care about and its line span.

3. Read ONLY that span with the Read tool's `offset`/`limit` (e.g. a symbol at
   `201-253` → `Read(file, offset=201, limit=53)`). Do not read the whole file
   unless you are about to edit it and need exact surrounding content.
</procedure>

<constraints>
- Read-only. The engine never writes; it only emits the skeleton.
- This is for NAVIGATION (understanding where code lives). When you are editing a
  file and need exact byte context, a full read is still correct.
- The engine is `scripts/fleet/gen/repo-map.mts` — this skill is a thin wrapper;
  fix parsing/behavior there, not here.
</constraints>

<why>
Re-reading context across turns dominates model spend. A whole file read
accumulates in context and is re-read every subsequent turn; a skeleton +
targeted span keeps the per-turn context small. On the shared hook libs the
skeleton is ~8% of source size.
</why>
