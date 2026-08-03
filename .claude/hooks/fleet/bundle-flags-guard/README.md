# bundle-flags-guard

PreToolUse Edit/Write hook that blocks shipped-build configs from
enabling source maps, declaration maps, or minification.

## Why

Two fleet rules collapse here:

1. **No source maps in shipped output.** `.js.map` and `.d.ts.map`
   files leak source paths and enlarge ship artifacts. TypeScript's
   language server reads `.ts` directly without maps; runtime
   debuggers (Node `--enable-source-maps`) only need maps when
   they're co-deployed, which fleet packages don't do.
2. **No minification of esbuild / rolldown output.** Minified
   bundles obscure stack frames in production and complicate
   security review of shipped JS. The fleet ships readable bundles.

Both rules apply to **shipped** output (`dist/`, `build/`,
`packages/*/build/`) — not local IDE tooling or one-off scripts.

## What it blocks

The hook checks `tsconfig.json` (any depth) and bundler configs
(`esbuild.config.*`, `rolldown.config.*`, `tsdown.config.*`,
`tsup.config.*`) for these keys flipping `false → true`:

| File            | Key flipped to `true`         |
| --------------- | ----------------------------- |
| `tsconfig.json` | `sourceMap`, `declarationMap` |
| bundler config  | `sourcemap`, `minify`         |

The block fires only on **transitions** (key absent or `false` →
`true`). It does not fire on:

- Files that already had the key `true` before the edit (you can't
  fix it without first writing the bad state — bypass is for that).
- Removals (`true → false` → never blocks).
- Comments containing the key.
- Test-only configs under `**/test/**` or `**/__tests__/**`.

## Bypass

Type the canonical phrase in a new message:

    Allow bundle-flags bypass

Legitimate cases: a debug-only build variant that doesn't ship, or
vendored config you're consuming verbatim.

## Detection

For `tsconfig.json`: parses both before+after JSON, reads
`compilerOptions.sourceMap` and `compilerOptions.declarationMap`,
flags any flip to `true`.

For bundler configs: scans new lines for `sourcemap: true` /
`sourcemap: 'inline'` / `minify: true` outside comments. The
bundler check is regex-based (esbuild/rolldown configs are JS, not
JSON, so a parser would need a real JS engine).

Fails open on parse errors.

## Fix

Set the flag explicitly to `false`:

```json
// tsconfig.json
{
  "compilerOptions": {
    "declarationMap": false,
    "sourceMap": false
  }
}
```

```ts
// esbuild.config.mts / rolldown.config.mts
export default {
  minify: false,
  sourcemap: false,
}
```
