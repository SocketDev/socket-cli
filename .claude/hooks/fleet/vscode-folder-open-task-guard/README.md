# vscode-folder-open-task-guard

PreToolUse `Edit`/`Write`/`MultiEdit` guard. Blocks committing a VS Code task
that auto-runs on folder open.

## What it blocks

A `.vscode/tasks.json` — or a `*.code-workspace` with an embedded `tasks`
block — containing:

```jsonc
"runOptions": { "runOn": "folderOpen" }
```

`folderOpen` makes VS Code execute the task the instant the folder is opened —
zero clicks, before the user reviews anything. It's a known drive-by /
supply-chain RCE vector: a malicious dependency, a malicious PR, or a poisoned
cascade can ship one, and it pairs with infostealer payloads. Auto-run-on-open
is never a legitimate thing to commit into a fleet repo.

## Why a guard on top of the gitignore

`.vscode/` is ignored fleet-wide (only `settings.json` is re-included), so a
`tasks.json` normally can't be committed at all. This guard is the backstop for
an explicitly force-added file, and it also covers `*.code-workspace` (which the
`.vscode/` ignore doesn't catch). Defense in depth — the dependency-side leg is
handled by Socket's scanner + the soak.

## Detection

Matches the `"runOn": "folderOpen"` key/value tolerantly (JSONC comments +
whitespace) rather than JSON-parsing, so a comment can't slip a malicious task
past the check.

## Bypass

`Allow vscode-folder-open-task bypass` verbatim in a recent message — rare; e.g.
authoring this guard's own test fixtures.
