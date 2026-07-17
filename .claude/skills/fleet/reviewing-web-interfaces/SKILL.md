---
name: reviewing-web-interfaces
description: Reviews web interface quality before landing UI changes.
---

# Reviewing Web Interfaces

Use evidence from a rendered interface. This is a review skill, not permission to
redesign a product without the [Refero Design](../refero-design/SKILL.md) reference lock.

## Workflow

1. Capture the affected route and viewport(s) with
   [rendering-chromium-to-png](../rendering-chromium-to-png/SKILL.md).
2. Review semantics, keyboard flow, focus, overflow, contrast, responsive states, and
   visible hierarchy using [review-checklist.md](references/review-checklist.md).
3. When `impeccable` is declared in the current repo, run its deterministic detector
   against the changed UI. Treat its findings as review leads; verify each one against
   the product context before changing code.
4. Re-render after each material correction. Report the remaining risks with evidence.

## Impeccable Availability

The fleet catalogs `impeccable` for UI-owning repos. Add it to that repo's
`devDependencies` as `"impeccable": "catalog:"`; never use an ad-hoc download in a
review. See [tooling.md](references/tooling.md) for command and installation boundaries.

## References

- [Review checklist](references/review-checklist.md)
- [Impeccable tooling boundary](references/tooling.md)
