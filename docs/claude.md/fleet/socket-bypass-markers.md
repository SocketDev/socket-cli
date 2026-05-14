# socket-bypass: in-file marker registry

Some fleet audits + custom lints recognize an explicit opt-out comment that lives inside the affected file. This is distinct from user-typed bypass *phrases* (see [bypass-phrases.md](./bypass-phrases.md)), which gate one-time tool invocations from the active conversation.

The marker shape is:

```
# socket-bypass: <name> -- <reason>
```

or in TS/JS source:

```ts
// socket-bypass: <name> -- <reason>
```

Conventions:

- `<name>` is the rule-specific identifier (kebab-case).
- The `--` separator + free-text `<reason>` is encouraged but not parsed. Git blame is the audit trail.
- The marker is matched **case-sensitive**, **substring-based on a line**. Most audits expect the marker as a header comment (top-of-file), but rule-specific positioning is documented below per name.

## Registered marker names

| Name              | Enforcer                                       | Effect                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-shadow` | `scripts/lint-github-settings.mts`             | Suppress the "Local workflow shadows a shared one" finding for the file. Document `<reason>` (e.g. "CLI-specific multi-package publish; does not fit generic shared shape"). Marker must appear as a `#`-comment line in the workflow YAML body — typically near the top, alongside the `name:` line. |

## When to add a new marker

When a new audit / custom lint needs an opt-out mechanism:

1. Pick a `<name>` (kebab-case, rule-scoped — e.g. `provenance-no-attestation`, not just `attestation`).
2. Implement the marker check in the audit (regex pattern: `^[ \t]*[#/]+\s*socket-bypass:\s*<name>\b`).
3. Add a row to the table above with the enforcer + effect.

## Why a separate registry from `bypass-phrases.md`

`bypass-phrases.md` documents user-typed phrases (`Allow revert bypass`) that the *active conversation* must contain for a hook to let a one-time tool-call proceed. Those phrases gate behavior at *invocation time*.

`socket-bypass:` markers gate behavior at *audit time* and live inline with the file they exempt. The file's git blame is the accountability trail; the maintainer is committing to the exemption.

Different lifetimes, different audiences, different review patterns. Two registries.
