# agent-prompt-budget-guard

**Event:** PreToolUse (`Task`, `Agent`) · **Type:** guard (blocking, exit 2)

Refuses an **expensive, open-ended** subagent spawn whose prompt states neither
a **budget**, meaning a wall-clock, tool-call, or response-length ceiling, nor
a **done-condition**, meaning an explicit statement of what finished looks
like. Either one alone is enough to pass. Both must be missing before it fires.

[`agent-delegation`](../../../../docs/agents.md/fleet/agent-delegation.md)
already requires both, and picks the tiers — sanity ~2 min, second
implementation ~5 min, deep rescue ~15 min. Nothing enforced it: on 2026-08-03
seven subagents ran 40-129 minutes each, 117-203 tool calls, every brief
bundling several deliverables behind an open-ended investigation with no budget.

## Why a guard and not a nudge

A `notify` verdict exits 0, and on the PreToolUse path exit-0 stderr is
transcript decoration — the **block** message is what is handed back to the
spawning model, which is the only party who can fix the prompt. The advisory
form of this law also already lost: the doctrine was written down, five
spawn-time nudges were live, and the fan-out shipped anyway.

The usual case against a guard is that a wrong block gets bypassed and then
ignored. That turns on the cost of clearing it, and here the remedy is one line
of prompt text authored by the model that is already mid-spawn. Precision is
bought at the detector instead of by weakening the verdict.

## Trigger

Fires only when **all** hold:

- the tool is `Task` or `Agent` (a `SendMessage` resume is never matched — it
  inherits the original brief's budget),
- the prompt is at least **500 words** (short one-shots pass through),
- the prompt carries an **open-ended signal** (`audit`, `investigate`,
  `research`, `sweep`, `end-to-end`, `root cause`, `wherever`, …),
- that signal sits where the brief **instructs**: quoted and code spans are
  blanked first, and a word that doubles as a fleet noun (`audit`, `catalog`,
  `diagnose`, `explore`, `inventory`, `migrate`, `research`, `survey`, `sweep`,
  `triage`) counts only in a verb position, so `pnpm audit`, `catalog.mts`,
  `diagnoseStageConflict`, `--audit`, `audit-driven`, "the repo's audit", and
  "sweep results" all read as prose (`signal-position.mts`), and
- it is missing **both** a budget and a done-condition.

## Where the two thresholds come from

Both were measured against 2,100 real spawns from 2026-07-01 to 2026-08-03
rather than picked by feel.

<details>
<summary><b>Detail</b> — Bypass</summary>

| Setting | First cut | Shipped | Why it moved |
| --- | --- | --- | --- |
| Word floor | 60 | **500** | A 60-word floor admitted 98.7% of all spawns. The median brief runs 369 words, so the floor discriminated almost nothing and the whole verdict rested on the open-ended signal. 500 sits between p75 (554) and p90 (764), which is where the 40-to-129-minute runs actually lived. |
| Missing rule | either | **both** | Only 2.5% of briefs state a done-condition at all, so an either-missing rule fires on 29.3% of all delegation. A block that common gets bypassed on day one and then ignored. |

Fire rate as shipped: **9.7%** of spawns.

Retuning the floor is expected, and the unit tests are built for it. Most
fixtures are padded *from* `MIN_BRIEF_WORDS`, so they follow the constant
instead of rotting when it moves. The catch is that padded fixtures also stay
green when the constant is plain wrong, which is the shape this repo calls a
gate that cannot fail, so three cases pin the number directly: one word under
the floor must stay silent, exactly at the floor must block, and the constant
itself must land in the 200-1000 band. Move it outside that band and the suite
goes red on purpose.

Detection is regex over prose — no shell binary appears in any pattern, so
`no-hook-cmd-regex-guard` does not apply. Plain `.includes` cannot express
"N minutes" or "N tool calls", which are the natural spellings the doctrine
asks us to accept.

**Known false negatives, chosen:** a long but tightly-scoped brief with no
open-ended verb passes. A false positive on every spawn would get this hook
deleted within a day; the doc's own example of the failing shape is "Audit our
cascade infrastructure". An inflected form is a longer word than its signal, so
"auditing every consumer" reads as prose the same way every signal's other
inflections do, and a brief whose only open-ended words sit inside quotation
marks passes, which is the price of reading a quoted incident title or a pasted
upstream sentence as a citation. A quoted span never crosses a newline, so
quoting cannot blank a whole brief.

**Bypass:** `Allow agent-budget bypass` in a recent turn.

Detail: [`agent-delegation`](../../../../docs/agents.md/fleet/agent-delegation.md).

</details>
