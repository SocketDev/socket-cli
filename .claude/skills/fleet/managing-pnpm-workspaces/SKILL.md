---
name: managing-pnpm-workspaces
description: Maintains pnpm workspace dependencies safely.
---

# Managing pnpm Workspaces

This is the entry point for pnpm-specific work. It complements the fleet update and
dependency-deduplication skills; it does not replace their policy.

## Workflow

1. Read [catalog-policy.md](references/catalog-policy.md).
2. Add shared third-party versions to the catalog, then declare consumers as `catalog:`.
3. Run the repository’s update/install/fix/check sequence. Commit a lockfile only when
   the repository policy requires it.
4. Use [deduping-dependencies](../deduping-dependencies/SKILL.md) for duplicate trees
   and [updating](../updating/SKILL.md) for the broader maintenance workflow.

## References

- [Catalog policy and pnpm source](references/catalog-policy.md)
