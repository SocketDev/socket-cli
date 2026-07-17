# Catalog Policy

The fleet uses `catalog:` references to centralize approved versions. Add a package to a
repo’s `devDependencies` only when that repo runs it; a catalog entry alone does not make
it a universal dependency.

## Source Map

- [pnpm skill](https://ui-skills.com/skills/antfu/pnpm)
- [pnpm workspace documentation](https://pnpm.io/workspaces)

For cross-fleet changes, preserve the soak, lockfile, and cascade rules in the existing
fleet skills. Do not use `npm install`, `npx`, or a `link:` dependency to bypass them.
