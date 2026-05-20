# acorn-wasm — shared parser for fleet hooks

Vendored from
[`@ultrathink/acorn-monorepo`](https://github.com/SocketDev/ultrathink/tree/main/packages/acorn)'s
Rust → WebAssembly prod build (path:
`packages/acorn/lang/rust/build/prod/darwin-arm64/wasm/out/Final/`).
Pending `@ultrathink/acorn` ship to the npm registry, fleet hooks
that need AST-aware analysis `import` from here.

## Provenance

The three vendored files come straight from the ultrathink prod build:

- `acorn.wasm` — compiled Rust acorn parser, ~3.3 MB.
- `acorn-bindgen.cjs` — wasm-bindgen JS glue.
- `acorn-wasm-sync.mts` — sync ESM loader (no top-level await,
  `WebAssembly.Instance` constructed at module import).

The artifact is rebuilt in ultrathink with `pnpm run
build:wasm:node:release` from `packages/acorn/lang/rust`.

## Refreshing

Hooks importing this directory don't need to do anything special —
the cascade keeps the files byte-identical with the ultrathink
canonical source. To pull a newer build:

```bash
# Inside socket-wheelhouse (the canonical source for fleet template):
node scripts/refresh-vendored-acorn.mts
```

The script reads from
`$ULTRATHINK_ROOT/packages/acorn/lang/rust/build/prod/darwin-arm64/wasm/out/Final/`,
copies the three files into this directory, and updates this README's
"Last refreshed" line.

Last refreshed: 2026-05-20 (ultrathink build dated 2026-05-20).

## Public surface

`template/.claude/hooks/_shared/acorn/index.mts` is the canonical
import path for fleet hooks. It re-exports a narrow `tryParse` /
`walkSimple` / `findBareCallsTo` surface — see the module's JSDoc for
the parse-failure tolerance + visitor patterns hook authors rely on.

Don't import `acorn-wasm-sync.mts` directly from hooks; the `index.mts`
wrapper provides the failure-handling + visitor adapters every hook
needs.

## Why vendor instead of `import 'acorn'`

- **No JS parser in the npm dep graph.** Hooks fire on every Edit/Write.
  A 3-5 MB JS bundle in `node_modules` adds startup latency and Socket-
  score risk on every fleet repo.
- **AST parity with the lint plugin.** Both surfaces (oxlint via plugin
  - hook via this loader) use the same acorn semantics — the rules can
    share visitor logic without divergence between commit-time and
    edit-time.
- **wasm sandbox.** The parser runs in WebAssembly with no filesystem
  / network access — even a malicious source file under analysis can't
  reach the host.

Retire this directory once `@ultrathink/acorn` ships and the wheelhouse
catalog can pin it.
