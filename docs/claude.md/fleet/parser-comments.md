# Parser comments + upstream source pinning

Referenced from CLAUDE.md → _Code style_.

The default rule for comments (default to none; write only the load-bearing _why_) has a deliberate exception for **parser code that mirrors an upstream reference implementation**. Examples in the fleet: `test262-parser-runner` (mirrors `adrianheine/test262-parser-runner`), the eco lockfile parsers (mirror sdxgen + per-pm reference behaviors), `smol-manifest` C++ bindings (mirror the same eco parsers as native impls), the acorn grammar rules (mirror upstream `acornjs/acorn`).

For these files:

## 1. Comment freely about steps

Walk the reader through what each block does in terms the upstream reference uses. The dual-impl invariant (TS ↔ native, JS ↔ C++) only holds if both halves can be verified against the same prose. Step-by-step comments are the cheapest way to keep them aligned across forks.

## 2. Cite the upstream source

When a method, regex, or branch derives from a specific spot in the upstream, link it. Prefer permalinks pinned to a specific tag or commit SHA — `https://github.com/<owner>/<repo>/blob/<tag-or-sha>/<path>#L<line>` — over branch-pointing links that bitrot when upstream moves.

```ts
// Upstream: acornjs/acorn @ 8.14.0
// https://github.com/acornjs/acorn/blob/8.14.0/acorn/src/state.js#L237
// Adopts the same eight-bit options vector; the lower three bits
// carry the parse mode and the upper five are reserved for jsx /
// typescript / strict flags.
```

## 3. Use upstream pins as guides

When the fleet repo already has an upstream pin (in `xport.json`, `lockstep.json`, `.gitmodules`, an `external-tools.json` block, or a header comment referencing a SHA), reuse that same pin in citations within the same file. Drifting between "the pin in xport.json says SHA-A" and "the file's header comment cites SHA-B" is a confusion source. The pin file is the source of truth; comments reference it.

```ts
// Upstream pin: lockstep.json → acornjs/acorn → 8.14.0
// (this file mirrors acorn/src/state.js as of that tag)
```

## 4. Deviations get a paragraph, not a line

When the local impl diverges from upstream (faster path, different error shape, missing edge case), write a short paragraph explaining *why* the divergence is intentional. One-line `// differs from upstream` notes get stripped during cleanups; paragraphs survive because they carry the load-bearing _why_.

## Scope

This exception applies to:

- Parsers + tokenizers (eco lockfile, JS/TS source parsers, AST walkers)
- Wire-format encoders/decoders (JSON, YAML, TOML, INI)
- Format conformance suites (test262, eco runners)
- Native bindings of any of the above

It does NOT apply to:

- Glue code (orchestration, CLI wiring, file routing)
- Public API surfaces
- Code that doesn't have an upstream reference

Default rules apply for those. The exception buys verbosity only when the verbosity is load-bearing (cross-impl alignment).
