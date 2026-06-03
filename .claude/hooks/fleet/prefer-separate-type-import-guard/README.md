# prefer-separate-type-import-guard

PreToolUse (Edit/Write) hook — the edit-time half of the `socket/prefer-separate-type-import` lint rule. Blocks writing an inline `type` specifier inside a value import.

## What it catches

A value import whose brace body carries a `type` specifier:

```ts
import { Value, type TypeOnly } from './mod' // ✗
import { type TypeOnly } from './mod' // ✗
```

Wants them split:

```ts
import { Value } from './mod'
import type { TypeOnly } from './mod'
```

Well-formed `import type { … }` statements are not flagged.

## Why

The lint rule already autofixes this at commit, but the hook stops the wrong shape being written at all (defense in depth: skill + hook + lint, same shape as `prefer-function-declaration-guard`). Across the fleet, separate `import type` statements outnumber inline `type` specifiers ~200:1; mixing the two defeats the sorted-imports rules that group type imports separately.

## Bypass

- `Allow separate-type-import bypass` in a recent user message, or
- `SOCKET_PREFER_SEPARATE_TYPE_IMPORT_GUARD_DISABLED=1`.

## Test

```sh
pnpm test
```
