# file-size-reminder

Stop hook that warns when an assistant turn's Write / Edit / NotebookEdit tool calls push a file past the 500-line soft cap or 1000-line hard cap.

## Why

CLAUDE.md "File size" rule:

> Soft cap **500 lines**, hard cap **1000 lines** per source file. Past those, split along natural seams — group by domain, not line count; name files for what's in them; co-locate helpers with consumers. Exceptions: a single function that legitimately needs the space (note it inline), or a generated artifact.

The intent is to catch the slide where a file gradually accumulates 600, then 700, then 1200 lines because nobody noticed each individual edit pushing it over. The hook surfaces the count alongside the edit so the next turn can act on it.

## What it catches

After each assistant turn, the hook walks the most recent assistant's tool-use events, finds calls to:

- `Write` (creating a new file or full rewrite)
- `Edit` (modifying a file in place)
- `NotebookEdit` (Jupyter cell modifications)

For each target `file_path`, it reads the current on-disk state (post-edit, since the hook fires after the tool ran), counts lines, and warns if the count is past either cap.

| Cap | Threshold | Action |
|---|---|---|
| Soft | 501-1000 lines | Warning — start planning the split |
| Hard | 1001+ lines | Stronger warning — split now |

## Exempt paths

Generated / vendored / build-output paths are skipped to avoid noise:

- `node_modules/`, `.cache/`, `coverage/`, `coverage-isolated/`
- `dist/`, `build/`, `external/`, `vendor/`, `upstream/`
- `.git/`, `test/fixtures/`, `test/packages/`
- `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`
- `*.d.ts`, `*.d.ts.map`, `*.tsbuildinfo`, `*.map`

The skip list errs on the side of suppressing false positives — genuine in-scope files past the cap will still surface.

## Why it doesn't block

Stop hooks fire after the tool has run. Blocking would just truncate the warning. The size violation is in the diff already; the warning prompts the next turn to address it.

## Configuration

`SOCKET_FILE_SIZE_REMINDER_DISABLED=1` — turn off entirely. Useful for sessions intentionally working on a generated-file context the skip list doesn't recognize.

## Test

```sh
pnpm test
```
