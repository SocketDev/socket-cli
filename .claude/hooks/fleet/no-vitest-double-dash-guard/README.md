# no-vitest-double-dash-guard

**Type:** PreToolUse(Bash) hook (BLOCK — exit 2).

## Trigger

Blocks a Bash command that puts `--` before a vitest test path:

```
pnpm test -- test/foo.test.mts
pnpm run test -- path/to/foo.test.mts
node_modules/.bin/vitest run -- foo.test.mts
```

Detection is AST-based — the fleet shell parser via `parseCommands` — per
`no-command-regex-in-hooks-guard`. It matches a vitest binary (`vitest` or
`node_modules/.bin/vitest`) OR a `pnpm`/`npm`/`yarn` `test` / `run test` script
invocation, then flags a `--` token followed by a non-flag positional.

## Why

The `--` is consumed by the script runner (pnpm/npm) as its own
args-separator, so vitest receives **no positional filter** and runs the
**entire suite** instead of the one file you targeted. The full suite can be
minutes; in a few fleet repos it sweeps `.claude/hooks` tests and hangs. The
intent is always "run this one file" — the `--` silently defeats it.

The fix is to drop the `--`; the positional path forwards fine without it:

```
pnpm test test/foo.test.mts
node_modules/.bin/vitest run test/foo.test.mts
```

This recurs across socket-cli, socket-registry, and socket-mcp — promoted to
one fleet guard rather than three repo-local copies.

## Bypass

Type the exact phrase in a recent message:

```
Allow vitest-double-dash bypass
```

Fails open on a malformed payload or unparseable command.
