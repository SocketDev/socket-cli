---
name: authoring-spec
description: Turn the current conversation into a spec: problem, solution, stories, tests, enforcement.
user-invocable: true
---

# authoring-spec

Turn the conversation + codebase understanding into a spec. Do NOT interview — just
synthesize what you already know. Adapted from `mattpocock/to-spec`; the natural
input to `decomposing-tickets`. Two fleet additions: test seams are a first-class
output, and every spec names its **enforcement plan**.

## 1. Explore

Explore the repo (if you haven't) so the spec uses the project's domain vocabulary;
respect ADRs in the area.

## 2. Identify the test seams

Sketch the seams at which the feature is tested. Prefer **existing** seams; use the
**highest** seam possible; the fewer across the codebase the better — the ideal is
one. New seams go in at the highest point. Fleet seam doctrine:
[`test-layout`](../../../../docs/agents.md/fleet/test-layout.md) (public interface, no
source-text assertions). Check the seams with the user before writing.

## 3. Write the spec

Sections: **Problem** (user's perspective) · **Solution** (user's perspective) ·
**User Stories** (a long numbered "As an <actor>, I want <feature>, so that
<benefit>" list, exhaustive) · **Implementation Decisions** (modules, interfaces,
schema/API contracts — no file paths or code snippets, they go stale; exception: a
prototype snippet that encodes a decision more precisely than prose) · **Testing
Decisions** (what makes a good test here, which modules, prior art) · **Enforcement
plan** · **Out of Scope**.

**Enforcement plan** is the fleet's code-is-law addition: name which hook / lint
rule / check script will verify each discipline the feature introduces. A spec that
introduces a rule with no enforcer is policy on paper
([`code-is-law`](../../../../docs/agents.md/fleet/code-is-law.md)).

## 4. Prose + doctrine pass

The spec is a public-facing surface. Run the `prose` skill over it and apply
[`prose-style-and-doctrine`](../../../rules/fleet/prose-style-and-doctrine.md):
lead with the point, cut throat-clearers/hedges/filler, evidence over assertion.
Public-surface hygiene: no real customer/company name, no private repo, no Linear
ref, no bare `#N`.

## 5. Publish

Publish to the tracker (GitHub via `gh`, or the Linear MCP `save_document` /
`save_issue` tool) with the ready-for-agent triage label. Publishing is mutating +
outward-facing — confirm the destination first.

## Completion criterion

The spec has all sections including named test seams and an enforcement plan,
passed the prose + doctrine pass, leaks no private name, and is published to the
confirmed tracker.

## Handoffs

Use [grilling-plan](../grilling-plan/SKILL.md) to challenge the plan,
[decomposing-tickets](../decomposing-tickets/SKILL.md) to publish slices, and
[building-tdd](../building-tdd/SKILL.md) to implement them.
