# A security primitive with no callers is not a control

An SSRF gate, a PATH de-poisoning resolver, a shadow-bin walker, a redaction
pass: a function that refuses something protects nothing until a request path
calls it. Until then it is a **dormant primitive**. It has a name, it has
tests, it greps like coverage, and it enforces nothing.

This is not hypothetical. One review turned up four in a single sitting:

- A `findRealBin` / `findRealNpm` family plus `isShadowBinPath`, written to
  walk past `node_modules/.bin` shims that intercept a package-manager call.
  No importer anywhere until one was wired during that review.
- `assertSafeHttpUrl`, an SSRF guard whose own doc names cloud metadata by
  address. **Zero consumers in any repo**, while the CLI's API-token
  destination went unvalidated and a second repo carried a hand-rolled fork of
  the same function.
- A `resolveTrustedExecutable` module inverting PATH trust for spawn sites,
  reachable from one call site only.
- A `loopbackOnly` bind parameter, defined, defaulted to `false`, never passed
  `true` by any caller.

Each read as protection in review. None was wired.

## The rule

- **A security-annotated export needs a non-test caller in its own repo.**
  Enforced by `scripts/fleet/check/security-primitives-have-consumers.mts`.
- **A test is not a caller.** A test proves the primitive *works*; only a call
  site proves it *runs*. The exact failure this gate exists to catch is a
  well-tested control nothing invokes, so counting tests would green every case
  that motivated it.
- **Neither is a doc mention or a barrel re-export.** Both are stripped before
  the scan matches, so an `@example` block or an `export { x } from` line
  cannot stand in for a call.
- **A use inside the declaring module counts.** That module's own entry point
  carries it; only the entry point itself has to be reachable from outside.

## What makes an export "security-annotated"

An explicit `@security` JSDoc tag always qualifies. It is not the primary
signal, though: a tag only finds the primitives someone remembered to tag, and
nobody had tagged any of the four above. The working signal is the prose these
controls already carry, scored against two vocabularies.

**Named threats** (`NAMED_THREATS`) are terms like `ssrf`, `xss`, `csrf`,
`path traversal`, `prototype pollution`, `shadow bin`, `cloud metadata`,
`attacker`, `hostile`, `malicious`, `zip slip`. These appear in prose only when
describing an attack, so **one is enough**. The shadow-bin walker's entire
security vocabulary is a single such term, and a two-term floor would miss it.

**Ambiguous terms** (`AMBIGUOUS_TERMS`) are terms like `loopback`, `sanitiz`,
`redact`, `privilege`, `tamper`, `untrusted`, `spoof`. These also occur in
ordinary prose ("the loopback interface", "ingesting JSON from untrusted
sources" on any validator), so **one proves nothing and two together do**.

Generic words are absent by design: `guard`, `validate`, `check`, `safe`, and
`verify` saturate any codebase, and "type guard" alone would swamp the scan.

An export qualifies on any one of three grounds:

1. **Its own doc reaches `DENSE_ANNOTATION_SCORE`.** Enumerating several
   distinct threats states a purpose, so no module header can mask it.
2. **Its own doc reaches the floor and its module header scores at least one
   point.** At the floor the module has to declare the domain too. This is what
   separates a control from a cross-reference: a PATH lookup documented as "the
   inverse of the shadow-bin walker" names the guard it is *not*.
3. **It shows some intent inside a focused module** whose header clears the
   floor. Capped at `MAX_INHERITING_EXPORTS`, because past that a header
   describes a neighbourhood rather than each function.

Two term-matching details that cost real false positives:

- Every term is anchored at a **leading word boundary**. Unanchored, `rce`
  matches inside "sources" and "enforce" and inflates nearly every doc by a
  point.
- `shadow bin(s)` closes on the right too, so it does not catch Socket's own
  "shadow binary" product feature.

## Scope

Repo-**owned** source: `src/`, `lib/`, `scripts/repo/`, `packages/*/{src,lib}/`.

Cascaded trees (`scripts/fleet/`, `.config/fleet/`, `template/`) are excluded.
They are authored in socket-wheelhouse and byte-copied into every member, so a
member sees the file without its callers. Scanning them fails twenty repos for
one wheelhouse-owned export.

## The escape hatch is a statement, not a silence

A primitive legitimately awaiting a caller records that **in its own doc
comment**, naming who will call it or why nothing does:

```ts
/**
 * @unused No internal or Socket consumers; exercised only by its unit tests.
 */

/**
 * @security-disposition Published API — socket-cli's OAuth introspector calls it.
 */
```

`@unused` is honored because socket-lib already writes it, one convention
instead of two. The reason must carry content: a bare `@unused` with nothing
after it still fails, which is the point. Silence fails; a reasoned line passes.

When the gate fires, fix it in this order:

1. **Wire it.** Call it from the path it was written to protect.
2. **Delete it,** if that path is gone. The fleet deletes, it does not deprecate.
3. **Record the disposition,** if a real caller lives somewhere the scan cannot
   see.

## Zero candidates is not a pass

A repo that resolves no security-annotated export prints a loud notice and the
source-file count it scanned, never a green checkmark. A repo may genuinely
ship no security primitive, or the scan may have missed its source roots, and
those two states must not look alike from the terminal. Same discipline as
`scripts/fleet/lint.mts`, where a scope resolving to zero files reports
"0 files checked — this is NOT a pass" instead of "Lint passed".
