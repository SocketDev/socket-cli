# no-file-scope-oxlint-disable-guard

PreToolUse hook that blocks Edit/Write tool calls introducing a file-scope `oxlint-disable <rule>` comment.

File-scope disables (without `-next-line`) silently exempt every line of the file from a fleet rule — including lines added later by editors who never saw the disable. Inline `oxlint-disable-next-line <rule> -- <reason>` per call site forces a fresh justification next to each banned usage.

## Allowed

- `// oxlint-disable-next-line <rule> -- <reason>`
- `/* oxlint-disable-next-line <rule> */`
- `/* oxlint-enable <rule> */` (re-enables; pairs with disables)

## Blocked

- `/* oxlint-disable <rule> */` at file scope
- `// oxlint-disable <rule>` at file scope

## Exemptions

Files under `.config/fleet/oxlint-plugin/rules/` and `.config/fleet/oxlint-plugin/test/` may file-scope-disable their own rule (the banned shape is lookup-table data in the rule definition or test fixture).

## Disabling

Set `SOCKET_NO_FILE_SCOPE_OXLINT_DISABLE_GUARD_DISABLED=1` to bypass.
