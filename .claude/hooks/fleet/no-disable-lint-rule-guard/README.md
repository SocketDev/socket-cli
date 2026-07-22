# no-disable-lint-rule-guard

PreToolUse hook that blocks Edit/Write operations adding `"some-rule": "off"` (or `"warn"`) to any oxlint or `.eslintrc` config file.

## Why

Lint rules catch real classes of bug or style drift. Disabling a rule globally weakens the gate for every file matching its selector — and the disabled rule becomes invisible to future readers. The fleet rule: **fix the underlying code**, not the config.

## What it catches

Block examples:

- Adding `"socket/foo": "off"` to `.config/fleet/oxlintrc.json`
- Adding `"no-console": "warn"` to `.eslintrc.json`
- Writing a new lint config file that already contains rule disables

Allow examples:

- Editing a lint config to add new rules
- Editing a lint config to REMOVE a rule disable (i.e. re-enabling)
- Edits to any non-config file
- Per-line `oxlint-disable-next-line <rule> -- <reason>` comments: those live in source files, not config

## How to bypass

`Allow disable-lint-rule bypass` typed verbatim in a recent message. Use sparingly — the right answer is almost always to fix the code or use a per-line exemption with a reason.

## Test

```sh
pnpm test
```
