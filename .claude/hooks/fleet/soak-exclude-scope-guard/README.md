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

A common mistake is reaching for `overrides:` to get around the
soak. Overrides pin a version but do NOT exempt it from
`minimumReleaseAge`: pnpm still soak-checks the resolved version, so
overriding to a too-new release stays blocked. The gate is doing
its job — the right move is to wait for the 7-day window to pass.

Example: an automated PR that drops a third-party scope like
`@anthropic-ai/*` into `minimumReleaseAgeExclude` across sibling
repos has to be reverted everywhere, since the exclude weakens the
soak gate for every release of that scope.

## What it blocks

The hook fires on Edit/Write to `pnpm-workspace.yaml` when the
edit adds an entry under `minimumReleaseAgeExclude:` whose package
name is NOT scoped to one of:

    @socketaddon/*
    @socketbin/*
    @socketregistry/*
    @socketsecurity/*
    @stuie/*

Both glob-form (`@socketsecurity/*`) and exact-pin form
(`@socketsecurity/lib@6.0.0`) are accepted; the hook splits on
the version separator before checking scope.

Bare-name entries without a scope (e.g. `defu` or `defu@6.1.6`) are
the canonical violation.

## Bypass

Type the canonical phrase in a new message:

    Allow soak-exclude-third-party bypass

Legitimate case: a third-party package genuinely needed before its
soak clears, where waiting isn't an option. After the phrase, add
it (and any `@scope/*` platform binaries) under a
`# published: <date> | removable: <date + 7d>` annotation. This
knowingly weakens the soak for those exact pins until they age out.

## Detection

The hook parses both before+after YAML, walks the
`minimumReleaseAgeExclude:` block, and computes the set difference
of entries. Entries added → check scope. Non-Socket scope → block.

Fails open on YAML parse errors.

## Fix

Default: wait for the 7-day soak to clear. The gate is protecting
you, and `overrides:` will not bypass it.

If the package is needed before then, type the bypass phrase and add
it (with any platform binaries) under a dated annotation:

```yaml
# pnpm-workspace.yaml

minimumReleaseAgeExclude:
  - '@socketsecurity/*' # fleet-internal scopes need no date
  # published: <YYYY-MM-DD> | removable: <YYYY-MM-DD>
  - 'somepkg@1.2.3'
```
