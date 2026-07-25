---
name: reviewing-web-interfaces
description: Reviews web interface quality before landing UI changes.
metadata:
  internal: true
---

# Reviewing Web Interfaces

Use evidence from a rendered interface. This is a review skill, not permission to
redesign a product without the [Designing Interfaces](../designing-interfaces/SKILL.md) reference lock.

## Workflow

1. For a React shadcn app, run the deterministic shadscan audit first per
   [shadscan-audit.md](references/shadscan-audit.md) — it produces the missing
   UI fundamentals report from static evidence before anything renders.
2. Capture the affected route and viewport(s) with
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md).
3. For a material UI change, get a fresh-context critique when an independent reviewer is
   available. Keep its evidence separate from the implementation rationale.
4. Review semantics, keyboard flow, focus, overflow, contrast, responsive states, production
   states, and user-facing copy using [review-checklist.md](references/review-checklist.md)
   and [interface-copy.md](../designing-interfaces/references/interface-copy.md).
5. Re-render after each material correction. Report the remaining risks with evidence.

## Design Cluster

Review preserves the direction set by
[designing-interfaces](../designing-interfaces/SKILL.md). Route implementation fixes to
[improving-web-interfaces](../improving-web-interfaces/SKILL.md), performance findings to
[optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md), repeated patterns to
[extracting-design-systems](../extracting-design-systems/SKILL.md), and behavior or visual
regressions to [testing-web-interfaces](../testing-web-interfaces/SKILL.md).

## References

- [Review checklist](references/review-checklist.md)
- [Shadscan audit](references/shadscan-audit.md)
