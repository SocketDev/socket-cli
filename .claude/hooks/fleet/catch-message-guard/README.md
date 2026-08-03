# catch-message-guard

PreToolUse Edit/Write hook covering two related rules for `catch`
blocks in JS / TS code:

1. **Bare `${e.message}` blocked** — must route through
   `errorMessage(e)` (or an `instanceof Error` guard) so non-Error
   throws don't print `"undefined"`.
2. **Binding name must be `e`** — fleet convention. `err`, `error`,
   etc. drift over time and break the recipe in the bypass report.

## Why

A `catch (err)` binding is `unknown` in modern TS. Reading
`e.message` directly works when the thrown value is an `Error`,
but a thrown string / number / plain object has no `.message` and
the template-string interpolation silently prints `"undefined"`:

```ts
try {
  throw 'oops'
} catch (e) {
  // logs "Something failed: undefined"
  logger.error(`Something failed: ${e.message}`)
}
```

The fix is to route through `errorMessage()` from
`@socketsecurity/lib/errors/message` (workspace) or
`build-infra/lib/error-utils` (fleet builders), which returns
`e.message` for `Error` instances and `String(err)` otherwise.

## What it blocks

The hook scans every Edit/Write to `*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}`
for the pattern:

    } catch (<binding>) {
       ...
       `... ${<binding>.message} ...`
       ...
    }

within ~30 lines of the `catch`. The bare `.message` access is the
violation. A wrapped `errorMessage(<binding>)` or
`<binding> instanceof Error ? <binding>.message : String(<binding>)`
guard passes.

It skips:

- Comments + docstrings.
- Test files under `**/test/**` (test-only error-shape assertions
  often read `.message` directly when the test owns the throw).
- `// ok: catch-message ...` line marker for the rare legitimate
  case where the caller asserts the thrown value is an `Error`.

## Bypass

Type the canonical phrase in a new message:

    Allow catch-message bypass

Fails open on regex / parse errors.

## Fix

```ts
import { errorMessage } from '@socketsecurity/lib/errors/message'

try {
  await doWork()
} catch (e) {
  logger.error(`Something failed: ${errorMessage(e)}`)
}
```

For files that can't import the helper (root `scripts/*.mts`, CJS
`*.js`), inline the guard:

```ts
} catch (e) {
  const msg = err instanceof Error ? e.message : String(err)
  logger.error(`Something failed: ${msg}`)
}
```
