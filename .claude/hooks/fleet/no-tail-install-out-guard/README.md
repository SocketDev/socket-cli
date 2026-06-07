# no-tail-install-out-guard

PreToolUse Bash hook that blocks install/check/test commands piped into `tail` or `head`.

## Why

`pnpm i 2>&1 | tail -5` looks like a clean way to save context, but it ships releases with broken CI. pnpm prints its Socket Firewall footer at the very end of its output. Critical warnings — `[ERR_PNPM_IGNORED_BUILDS]`, peer-dep mismatches, soak-bypass tripwires — print **above** the footer. A small `tail`/`head` window captures the footer and the exit-code line, hiding every warning.

Locally, the install passes because `node_modules/` was already built from a prior run, so pnpm skips the build-script approval gate. On a fresh CI runner with no cached `node_modules/`, the gate fires and the build fails.

This was a real shipping bug: v6.0.4 of `@socketsecurity/lib` shipped with `[ERR_PNPM_IGNORED_BUILDS] esbuild@0.27.7` on the fresh CI runner. The warning was in the local `pnpm i` output but above the `tail -5` window. The tag pointed at a known-red SHA.

## What it blocks

Pipes where the LHS is one of these install-shaped commands and the RHS starts with `tail` / `head`:

| LHS                                                                                                                  | RHS                 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `pnpm i` / `pnpm install` / `pnpm add` / `pnpm update` / `pnpm up`                                                   | `tail …` / `head …` |
| `pnpm exec …`                                                                                                        | `tail …` / `head …` |
| `pnpm run check` / `run fix` / `run update` / `run install` / `run test` / `run cover` / `run build` / `run release` | `tail …` / `head …` |
| Same set under `npm` and `yarn`                                                                                      | same                |

Leading `NAME=value` env assignments (`CI=true pnpm i`) don't disguise the match.

## What it does NOT block

- `pnpm i | grep -i warning` — grep scans the full output, exactly the recommended replacement.
- `pnpm i && echo done | tail -5` — the tail consumes `echo`, not pnpm. The `&&` separates independent commands.
- `git log | tail -20`, `ls | head -10`, `find … | head -1` — not install/check output.
- `pnpm test | tee log.txt` — tee passes through; no truncation.

## How

The hook tokenizes the Bash command with `shell-quote`, splits on command separators (`|`, `&&`, `||`, `;`, `&`, newline), and looks for a `|` whose preceding segment is install-shaped and whose following segment starts with `tail`/`head`. The pipe operator is the only one that fires; `&&`/`;` mean independent commands.

Fails open on malformed payloads or parse errors (exit 0).

## Bypass

None. The replacement is always available — `grep -iE "warning|error|ignored|fail"` (or any scan over the full output) gives the same context savings without hiding errors above the footer.

## Test

```sh
pnpm test
```
