# no-platform-import-guard

PreToolUse Edit/Write hook that blocks direct imports of platform-specific
http-request entry points (`/node` or `/browser`) from outside the
http-request module itself.

## Why

`src/http-request/node.ts` and `src/http-request/browser.ts` are platform
implementations. Importing either one directly bypasses the package.json
`"browser"` condition that bundlers use to select the correct platform at
build time. Hard-coding `/node` in a browser build ships the wrong HTTP stack.

## What it blocks

| Pattern | Why |
|---|---|
| `import { httpJson } from '../http-request/node'` | Hard-codes Node.js platform |
| `import { httpJson } from '../http-request/browser'` | Hard-codes browser platform |
| `from '@socketsecurity/lib/http-request/node'` | Same, via package path |

## Exemptions

- Files inside `src/http-request/` — they form the implementation and may
  reference siblings directly.
- Line preceded by `// no-platform-http-import: <reason>` — inline disable
  for files that genuinely must pin a platform (e.g. a server-only util).

## Bypass

Type `Allow platform-http-import bypass` in chat.

## Test

```sh
node --no-warnings --test index.mts
```
