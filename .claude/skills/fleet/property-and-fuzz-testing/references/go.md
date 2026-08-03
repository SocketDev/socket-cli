# Go property + fuzz

## Tier 1 — table-driven properties

Go has no first-class property library in the fleet dep budget. Express
properties as table-driven tests with a seeded `math/rand` generator (seed from
`FUZZ_SEED`, default fixed) building inputs, plus `testing/quick` for the
simple total/round-trip cases. A discovered counterexample becomes a pinned
table row.

## Tier 2 — `go test -fuzz` (native, built-in)

Go's native coverage-guided fuzzer (libFuzzer-style, stdlib since 1.18) — no
external dependency, which is why it's the fleet default for Go. Reference:
`packages/acorn/lang/go/src/parser/fuzz_test.go` (a lock-step port of the Rust
reference lane; it adds NO new taxonomy/corpus/dict — it reads the ONE shared
substrate at `packages/acorn/fuzz/`).

### A fuzz target

```go
// fuzz_test.go  (same package as the SUT)
func FuzzParse(f *testing.F) {
    // Seed from the shared committed corpus (one raw input per file).
    for _, seed := range loadSharedCorpus("parse") {
        f.Add(seed)
    }
    f.Fuzz(func(t *testing.T, data []byte) {
        // Contract: on ANY bytes, never panic / hang / corrupt. A clean parse
        // error is a NON-finding. Strict UTF-8 decode on the boundary — report
        // parse_error on failure, never lossily replace (that masks a
        // cross-lane divergence).
        _, _ = Parse(data)
    })
}
```

### Run

```bash
go test -run=^$ -fuzz=FuzzParse       -fuzztime=45s ./src/parser/
go test -run=^$ -fuzz=FuzzParseToJSON -fuzztime=45s ./src/parser/
```

`-run=^$` disables the unit tests so only the fuzzer runs; `-fuzztime` is the
budget (CI widens it). A crash writes a reproducer to `testdata/fuzz/<Fuzz>/`
— **commit it** (it replays as a normal `go test` case forever after). Deep
nesting is bounded by a recursion-depth counter (`maxParseDepth`) that returns
a clean error before the goroutine stack overflows — the uniform cross-lane
contract, not a per-lane hack.

### Lock-step note

Where Go is one lane of a multi-language surface (acorn), it is a PORT of the
Rust reference: identical target names (`parse`, `parse_to_json`, `ast_cache`),
identical shared corpus/dict, identical classification taxonomy. Do not invent
a Go-only corpus format — read `packages/acorn/fuzz/`.

## Escalation

- **ClusterFuzzLite / OSS-Fuzz** for continuous fuzzing — bridge the native
  corpus with **`go-118-fuzz-build`**, which compiles a `go test -fuzz` target
  into a libFuzzer binary the ClusterFuzzLite/OSS-Fuzz runners drive. Same
  harness, continuous coverage.
- **`go-fuzz` (dvyukov)** predates the native fuzzer and still has richer corpus
  tooling; reach for it only if the native runner can't express a campaign
  (rare) — the native one is the default and lock-step-friendly.
- **`fzgen`** auto-generates harnesses for a wide API surface — useful to
  bootstrap coverage across many exported functions, then hand-tune the
  high-value targets.
- Run with `-race` in a separate CI lane to catch data races the fuzzer's
  inputs trigger (Go's TSan-equivalent).
