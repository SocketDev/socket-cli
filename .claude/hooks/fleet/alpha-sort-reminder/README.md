# alpha-sort-reminder

PreToolUse Edit/Write hook that nudges (never blocks) when a non-code file edit
introduces a sibling block that looks unsorted. oxlint only sees JS/TS, so the
`socket/sort-*` lint rules can't reach JSON / YAML / markdown / bash. This hook
covers those surfaces per [`docs/claude.md/fleet/sorting.md`](../../../../docs/claude.md/fleet/sorting.md).

## What it flags

| Surface                                            | Detects                                                                   | Key shape   |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| JSON / JSONC (`.json`, `.jsonc`, `.oxlintrc.json`) | runs of object keys at one indent, out of ASCII order                     | `"name": …` |
| YAML (`.yml`, `.yaml`)                             | runs of mapping keys at one indent (`env:` / `with:` / matrix)            | `name:`     |
| Markdown (`.md`, `.markdown`)                      | runs of `-`/`*` bullets out of order; bullets ending in `…`/`...`         | `- text`    |
| Bash (`.sh`, `.bash`)                              | runs of all-caps `NAME=…` assignments out of order (cache-key var blocks) | `NAME=…`    |

Detection is conservative: **3+** adjacent siblings at the same indent, ASCII
byte order only. False quiet beats false nag: a missed block is a review catch,
while a wrong nag trains the agent to ignore the hook.

## Trigger

Fires on `Edit` / `Write` tool calls. Reads `tool_input.file_path` +
`content`/`new_string` from the PreToolUse payload on stdin. Always exits 0; the
reminder is informational on stderr.

## Bypass

No phrase; the hook never blocks. For a genuinely order-bearing block,
leave it unsorted and state the reason inline (the hook is advisory; review
honors the stated reason).

## Why

John-David has asked for alphanumeric sorting across every file type repeatedly
(2026-04-17 → 2026-05-29: JSON config keys, README consumer lists, workflow YAML
matrix + bash cache-key vars, "no ellipsis"). Code surfaces got lint rules; the
non-code surfaces had no enforcement. This hook closes that gap at edit time.

## Companion files

- `index.mts` — the hook; `findUnsortedBlocks(filePath, content)` is the pure,
  exported detector.
- `test/index.test.mts` — node:test specs.
- `package.json` — workspace declaration so `taze` can see the hook's deps.
