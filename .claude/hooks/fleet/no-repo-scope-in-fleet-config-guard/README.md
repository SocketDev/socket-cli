# no-repo-scope-in-fleet-config-guard

PreToolUse Edit/Write hook. Blocks adding a **one-repo path-scope** into a fleet-canonical config under `template/.config/fleet/`.

## Why

The fleet config tier is for rules that apply to **every** member. A concern specific to one repo's tree belongs in that repo's own `.config/repo/` overlay, never the wheelhouse fleet config. The canonical example is socket-registry's `packages/npm/**` zero-dependency reimplementations, which some fleet lint rules should not touch. Reaching for the fleet `oxlintrc.json` to solve one repo's tree silently makes that exception fleet-wide.

This guards the inverse of `no-fleet-fork-guard`. That hook blocks editing a canonical file downstream; this one blocks a repo concern leaking into the canonical fleet tier — an edit `no-fleet-fork-guard` allows, since it targets the canonical home.

## What it catches

An Edit/Write to a guarded fleet config (`oxlintrc.json`, `oxlintrc.dogfood.json`, `oxfmtrc.json` under any `/.config/fleet/`) that **introduces** a non-universal path-glob in `overrides[].files` or `ignorePatterns`.

A glob is universal when it applies in every member regardless of layout: it starts with `**/`, is a bare extension pattern (`*.ts`), or is a managed marker (`#…`). A glob naming a concrete subtree, such as `packages/npm/**` or an un-anchored `src/foo/**`, is repo-specific and blocked. Only newly-introduced globs are flagged, so a pre-existing entry never blocks an unrelated edit.

## When it's a no-op

- Non-Edit/Write tools, or edits to any file that is not a guarded `/.config/fleet/` config.
- An edit whose introduced globs are all universal.
- Parse/payload errors (fail-open, so a guard bug never blocks work).

## The fix it points to

Put the override in the affected repo's own `.config/repo/` overlay, not the fleet config.

## Bypass

`Allow repo-scope-in-fleet bypass` typed verbatim in a recent turn, for the rare path that genuinely applies fleet-wide but cannot be `**/`-anchored.

## Test

```sh
node --test test/*.test.mts
```
