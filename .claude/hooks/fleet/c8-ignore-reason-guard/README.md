# c8-ignore-reason-guard

PreToolUse (Edit|Write) hook. Blocks introducing a `/* c8 ignore … */` or
`/* v8 ignore … */` coverage-ignore directive that carries no reason.

## Why

The fleet rule (`docs/claude.md/fleet/c8-ignore-directives.md`): a coverage
ignore is for external-library paths and genuinely-unreachable branches only,
and every directive must state *why* in the same comment. A reason lets a
reader distinguish a principled ignore from a coverage dodge on core SDK logic
(which is forbidden — write a test instead).

## Triggers

- A `c8`/`v8` `ignore next`/`ignore start` directive with no `- <reason>` /
  `— <reason>` trailing text, in a `.ts`/`.mts`/`.cts`/`.js`/… source file.
- `ignore stop` is exempt (its paired `start` carries the reason).
- `test/`, `fixtures/`, `external/`, `vendor/` paths are exempt.

## Bypass

- Type `Allow c8-ignore-reason bypass` in a recent message, or set
  `SOCKET_C8_IGNORE_REASON_GUARD_DISABLED=1`.
