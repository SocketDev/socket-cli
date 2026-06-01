# soak-exclude-scope-guard

PreToolUse Edit/Write hook that blocks adding non-Socket-scoped
packages to `minimumReleaseAgeExclude:` in `pnpm-workspace.yaml`.

## Why

The `minimumReleaseAgeExclude:` block in `pnpm-workspace.yaml` is a
**security policy bypass** for trusted first-party packages. The
7-day soak gate (`minimumReleaseAge: 10080`) is malware protection
that delays installing any release until it's been visible in the
public registry long enough for the ecosystem to flag bad code.

Adding a third-party package (e.g. `defu`, `@anthropic-ai/*`) to
the exclude list defeats the purpose of the gate for that package.

The fix for a third-party version that needs to bypass soak is a
**pnpm override**, not an exclude — overrides bypass the age check
without weakening the policy.

Past incident: 2026-04-06, an automated PR added `@anthropic-ai/*`
to `minimumReleaseAgeExclude` across 4 sibling repos
(socket-sdk-js, socket-cli, socket-registry, socket-lib). All four
had to be reverted to use `pnpm-workspace.yaml` `overrides:` instead.

## What it blocks

The hook fires on Edit/Write to `pnpm-workspace.yaml` when the
edit adds an entry under `minimumReleaseAgeExclude:` whose package
name is NOT scoped to one of:

    @socketsecurity/*
    @socketregistry/*
    @socketbin/*
    @socketaddon/*

Both glob-form (`@socketsecurity/*`) and exact-pin form
(`@socketsecurity/lib@6.0.0`) are accepted; the hook splits on
the version separator before checking scope.

Bare-name entries without a scope (e.g. `defu` or `defu@6.1.6`) are
the canonical violation.

## Bypass

Type the canonical phrase in a new message:

    Allow soak-exclude-third-party bypass

Legitimate case: a third-party transitive whose maintainer
publishes irregularly enough that the soak window genuinely can't
be relied on. Even then, prefer adding an `overrides:` entry over
an exclude.

## Detection

The hook parses both before+after YAML, walks the
`minimumReleaseAgeExclude:` block, and computes the set difference
of entries. Entries added → check scope. Non-Socket scope → block.

Fails open on YAML parse errors.

## Fix

Move the entry to `overrides:` instead:

```yaml
# pnpm-workspace.yaml

overrides:
  defu: '>=6.1.6'

minimumReleaseAgeExclude:
  - '@socketsecurity/*'  # ← fleet-internal only
  - '@socketregistry/*'
```
