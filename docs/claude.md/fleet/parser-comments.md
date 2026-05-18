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

When the local impl diverges from upstream (faster path, different error shape, missing edge case), write a short paragraph explaining _why_ the divergence is intentional. One-line `// differs from upstream` notes get stripped during cleanups; paragraphs survive because they carry the load-bearing _why_.

## 5. Lock-step references across language ports

When a parser ships in multiple implementations that must agree behaviorally (e.g. ultrathink's acorn ports: Rust / Go / C++ / TypeScript; socket-btm's `mcp/*.cpp` ports of upstream Python/Rust), every cross-impl reference uses the `Lock-step` prefix. The naming is load-bearing — `grep -r 'Lock-step'` is the audit surface.

Three forms, three jobs:

**File-level provenance** — top-of-file `//!` doc comment that names where the canonical source lives. Ports state who they follow; canonical files state who follows them:

```rust
//! Lock-step with Go: src/parser/class.go
//! Lock-step with C++: src/parser/class.cpp
//! Lock-step with TS: src/parser/class.ts
```

```go
//! Lock-step from Rust: crates/parser/src/class.rs
```

`Lock-step with X` = "X is a peer / downstream port; keep in sync". `Lock-step from X` = "X is the canonical source for this file".

**Inline cross-references** — point at the specific line range in the canonical impl. Include a colon-and-line-range so reviewers can jump:

```rust
// Lock-step with Go: parser.go:6450-6457
// Lock-step with Go: parser.go:6672-6682, upstream acorn: statement.js:737-745
```

In a port (Go/C++/TS), the reference points up at Rust. In Rust (canonical), the reference may point further upstream at Acorn JS — the rule is comments always point at the source-of-truth, never at a downstream port.

**Lock-step note** — explains a _deliberate_ divergence from the canonical shape. Reads like a thesis: here's the canonical idiom, here's why this impl can't follow it verbatim, here's the chosen reshape:

```cpp
// Lock-step note: Rust uses bumpalo-arena ownership for NodeVec;
// here we hold std::vector<NodeId> with manual reserve() because
// the C++ port can't share Rust's lifetime model. Capacity is
// pre-computed by parse_class_body's first pass — see parser.cpp:482.
```

```rust
// Lock-step note: reshaped for borrowck — Go's `defer s.restore()`
// returns a ResetScope holding &mut Path; capture len() and restore
// via set_length() so the path can be re-borrowed for append()
// in between.
```

The line `Lock-step with X` says "go look here"; the note `Lock-step note:` says "I already looked, and this is why I'm not matching shape-for-shape". Keep them distinct: a reviewer searching for missing lock-step refs filters by the former; a reviewer auditing _why_ this port diverges filters by the latter.

## 6. Don't let lock-step references rot

Paths in `Lock-step with X: <path>:<lines>` are claims about file layout that decay when ports get reorganized. A stale `Lock-step with Rust: crates/parser-stmt/src/...` reference after `crates/parser-stmt/` is renamed is worse than no reference — it lies to the reader.

Two cheap defenses:

- Reference paths, not symbols. `parser.go:6450-6457` survives a method rename; `parseClassBody` doesn't.
- Add a `scripts/check-lock-step-refs.mts` gate that greps every `Lock-step with <Lang>:` comment, resolves the path against the right impl root, and fails CI if the path no longer exists. Line ranges are advisory and can drift; path existence is enforceable.

## 7. Lock-step header — byte-identical intent across the quadruplet

Cross-references catch path rot. They don't catch _semantic_ drift — the case where the four impls quietly start disagreeing about what the file is _for_. The convention for that is a top-of-file **Lock-step header** block, byte-identical across every member of the quadruplet:

```rust
// BEGIN LOCK-STEP HEADER
// Class Parsing (Declarations, Expressions, Elements, Methods)
//
// Lock-step with Go: src/parser/class.go
// Lock-step with C++: src/parser/class.cpp
// Lock-step with TS: src/parser/class.ts
// END LOCK-STEP HEADER
```

```go
// BEGIN LOCK-STEP HEADER
// Class Parsing (Declarations, Expressions, Elements, Methods)
//
// Lock-step with Go: src/parser/class.go
// Lock-step with C++: src/parser/class.cpp
// Lock-step with TS: src/parser/class.ts
// END LOCK-STEP HEADER
```

```cpp
// BEGIN LOCK-STEP HEADER
// Class Parsing (Declarations, Expressions, Elements, Methods)
//
// Lock-step with Go: src/parser/class.go
// Lock-step with C++: src/parser/class.cpp
// Lock-step with TS: src/parser/class.ts
// END LOCK-STEP HEADER
```

Rules:

- **Single-line `// ` syntax across every language** — no `//!` / `///` / `/** */` mixing. Strip the leading `// `, byte-compare. Languages that need a doc-comment for tooling (Rust's `//!` for `rustdoc`, JSDoc for TypeScript) put that separately — the Lock-step header is its own block and lives alongside.
- **Mandatory: name + cross-refs.** First line is the file's purpose. Body lists `Lock-step with <Lang>: <path>` for every peer in the quadruplet, and `Lock-step from <Lang>: <path>` if the file is a port. The path forms are the same ones validated in §5.
- **No timestamps, no authors, no per-impl prose.** Anything that legitimately differs between impls goes _outside_ the header (in language-specific doc comments, `// PORT NOTE:` blocks, etc.). The header is the contract; divergence is contraband.

The gate (`scripts/check-lock-step-header.mts`, registered in the same opt-in `.config/lock-step-refs.json` as §5–6) walks the quadruplets named by each canonical-side header, extracts the `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP HEADER` block from each peer, and fails CI on any byte-diff. When the canonical impl needs to revise the contract, every peer must update in the same commit.

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
