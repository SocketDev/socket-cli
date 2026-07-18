---
name: decomposing-tickets
description: Break a plan, spec, or findings report into independently-grabbable vertical-slice tracker tickets.
user-invocable: true
---

# decomposing-tickets

Break a plan into **tracer-bullet** tickets — each a thin vertical slice through
ALL layers end-to-end (schema → API → UI → tests), demoable on its own — never a
horizontal slice of one layer. Adapted from `mattpocock/to-tickets`. The natural
output of `grilling-plan` → `authoring-spec` → this.

## 1. Gather + explore

Work from the conversation context (or fetch the referenced issue/plan). Explore
the codebase so issue titles use the project's domain vocabulary
(`rg` the affected modules). Look for prefactors — "make the change easy, then
make the easy change."

## 2. Draft vertical slices

Each slice: a narrow but COMPLETE path through every layer, verifiable on its own,
with prefactoring done first. For a findings report, one slice per true-positive
finding (or a tight cluster), each independently landable.

## 3. Quiz the user

Present the breakdown as a numbered list — title, **blocked by** (which slices
must land first), user stories covered. Ask: is the granularity right? are the
dependencies correct? merge/split any? Iterate until approved.

## 4. Prose + doctrine pass (before publishing)

Every issue body is a public-facing surface. Run the `prose` skill over each body
and apply [`prose-style-and-doctrine`](../../../rules/fleet/prose-style-and-doctrine.md):
lead with the point, no throat-clearers/filler, evidence over assertion, state the
positive directly. Public-surface hygiene
([`public-surface-hygiene`](../../../../docs/agents.md/fleet/public-surface-hygiene.md)):
no real customer/company name, no private repo, no Linear ref, and never a bare
`#N` in the prose (it auto-links to an unrelated issue) — write the full URL or
`org/repo#N`.

## 5. Publish in dependency order

Publish blockers first so you can reference real issue identifiers in each
"Blocked by" field. Default tracker is GitHub via `gh issue create`; use the
Linear MCP `save_issue` tool if the repo tracks work in Linear. Apply the
ready-for-agent triage label unless told otherwise. Publishing is mutating +
outward-facing — confirm the tracker + label before the first create.

## Completion criterion

Every approved slice is published in dependency order with real "Blocked by"
references, each body has passed the prose + doctrine pass, and no body leaks a
private name or bare `#N`.

## Handoff

Take an approved, ready-for-agent slice to [opening-pr](../opening-pr/SKILL.md).
