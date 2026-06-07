# no-pkgjson-pnpm-overrides-guard

PreToolUse Edit/Write hook that blocks adding (or expanding) a
`pnpm.overrides` block in any `package.json`.

## Why

pnpm reads dependency overrides from two places: `pnpm.overrides` in
`package.json`, or the top-level `overrides:` map in `pnpm-workspace.yaml`.
The fleet standardizes on the workspace file as the single override surface.

A `pnpm.overrides` block in package.json splits the source of truth: a
reviewer auditing pins now has to check two files, and the workspace file's
`trustPolicy: no-downgrade` only governs the overrides declared there. An
override hiding in a package.json can silently downgrade a transitive dep
past the trust policy.

## What it blocks

| Pattern                                                            | Block? |
| ------------------------------------------------------------------ | ------ |
| Edit/Write that adds a key under `pnpm.overrides` in package.json  | yes    |
| Edit/Write that removes a key from `pnpm.overrides`                | no     |
| Edit/Write touching package.json but not `pnpm.overrides`          | no     |
| Edit/Write to `pnpm-workspace.yaml` `overrides:` (the right place) | no     |
| Edit/Write to any other file                                       | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow package-json-overrides bypass

Rare legitimate case: a published package that ships its own
`pnpm.overrides` you're vendoring verbatim and must not rewrite.

## Detection

The hook parses both the current package.json and the after-edit contents
as JSON, reads `pnpm.overrides`, and computes the set difference of override
keys. Keys added → block. Keys removed or unchanged → pass.

Fails open on JSON parse errors: better to under-block than to brick edits
when the file is in a transient bad state.

## Fix

Move the override to the top-level `overrides:` map in `pnpm-workspace.yaml`,
then `pnpm install`:

```yaml
# pnpm-workspace.yaml
overrides:
  some-dep: '>=1.2.3'
```
