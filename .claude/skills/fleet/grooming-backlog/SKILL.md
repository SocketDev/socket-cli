---
name: grooming-backlog
description: Consolidate a bloated task backlog into a lean, accurate set — complete verified-done tasks, fold related clusters into umbrella survivors (folding each child's scope into the umbrella BEFORE deleting), delete superseded/duplicate/stale/parked, and keep in_progress honest (only actively-worked items). Use when the task list is noisy, when asked to "get pending under N", or to triage a stale in_progress list. The inverse of decomposing-tickets.
user-invocable: true
---

# grooming-backlog

Roll a sprawling task list back up into a lean, honest backlog. The inverse of
`decomposing-tickets` (which slices work *down* into tracer-bullet tickets); this
consolidates *up* — completing what's done, merging clusters into umbrellas, and
cutting what's dead — so the backlog reflects reality at a glance.

## When to use

- The task list is noisy — many micro-tasks, superseded items, stale
  `in_progress` entries nobody is actually working.
- The user asks to "get pending under N", "trim the backlog", or "consolidate the
  todos".
- Triaging an `in_progress` list where items were left mid-flight by prior
  sessions.

## Run in the MAIN session

Do the grooming inline in the main loop. The task tracker (`TaskList` /
`TaskGet` / `TaskUpdate`) is **unreachable from forked or Workflow subagents**
(see `workflow-agent-task-tools-nudge` / the workflow-agents-no-task-tools
memory) — a delegated groomer goes blind. Read status with the tracker here,
verify against the repo, and apply the tracker mutations here.

## Procedure

1. **Inventory.** `TaskList`; split by status (pending / in_progress /
   completed).
2. **Verify status — claims are leads, not facts.** For each open task,
   establish its ACTUAL state from code / git / the repo, not from the label or
   a stale "DONE" note. A task's own progress note or a subagent report is a
   lead — confirm (the file exists, the commit landed, the test is green) before
   completing it.
3. **Bucket each open task:**
   - **COMPLETE** — verifiably done (mark completed, with the receipt in mind).
   - **FOLD** — part of a larger effort → absorb into an umbrella survivor.
   - **DELETE** — superseded, duplicate, stale, or parked-indefinitely with
     nothing left to preserve.
   - **KEEP** — genuinely distinct and still-wanted → leave pending.
4. **Define umbrellas by theme, not by force.** Group only tasks that truly
   belong to one program. Common fleet themes: fleet-wide propagation waves; a
   release/publish campaign; a big pipeline/infra spec; a docs/ops program; an
   extension-polish umbrella; a code-as-law tooling backlog.
5. **Fold BEFORE you delete — deletion is PERMANENT.** First `TaskUpdate` the
   umbrella's description to absorb each child's scope (id + one-line intent);
   *then* delete the child. Never delete a task whose detail isn't captured in a
   survivor (or the session record). The umbrella is the durable record.
6. **`in_progress` must mean actively-being-worked.** Anything not being touched
   right now → complete (if done), fold (if gated or part of an umbrella), or
   delete (if stale). A gated-but-real item folds into its umbrella; it does not
   linger as "in progress".
7. **Narrate the full fold-map.** Report `absorbed-id → survivor` for every merge
   and every delete so the operator can split anything back out. Because deletes
   are permanent, this map is the reversibility guarantee.

## Guardrails

- **Completion needs a receipt.** Never mark a task completed to hide unfinished
  work — the same bar as `stop-claim-verify`.
- **Honest beats small.** Don't force-merge unrelated tasks just to hit a number;
  a lean-but-accurate backlog beats a small-but-lossy one.
- **Prefer FOLD over DELETE** when a task carries specific detail (wire
  contracts, version handshakes, file lists) — capture it in the umbrella.
- Complements `codifying-disciplines` (turns recurring lessons into enforcers)
  and inverts `decomposing-tickets` (which fans a plan out into tickets).
