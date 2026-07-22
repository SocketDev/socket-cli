# Rust property + fuzz

## Tier 1 — proptest (property)

`proptest` (explicit `Strategy` objects, good shrinking) over `quickcheck` for
new property tests; put them in a `#[cfg(test)] mod tests` next to the impl.
Round-trip + oracle properties for parsers/encoders; a discovered
counterexample becomes a pinned `#[test]`.

## Tier 2 — cargo-fuzz (libFuzzer) + ASan/UBSan

**The canonical fleet lane.** Reference implementations:
`packages/acorn/lang/rust/fuzz/`, the multi-lane source of truth, and
`envrypt/fuzz/` (single-lane, `parse_pipeline` / `ecies_decrypt` /
`upsert_roundtrip`). Mirror their shape exactly.

### `fuzz/` layout

```
fuzz/
  Cargo.toml            # standalone workspace, inverted profile, cargo-fuzz=true
  Cargo.lock            # COMMITTED — reproducible fuzz builds
  fuzz_targets/<t>.rs   # one #![no_main] target per untrusted-input entry
  corpus/<t>/           # COMMITTED seed inputs, one raw input per file
  fuzz.dict             # adversarial fragments (libFuzzer -dict format)
  run.sh                # single source of the per-target flags (local == CI)
```

### `fuzz/Cargo.toml` — the two non-obvious rules

```toml
[workspace]                       # EMPTY table → standalone workspace, so a
                                  # stray root `cargo build` never sweeps the
                                  # fuzzer in (parent sets exclude = ["fuzz"]).
[package]
name = "<crate>-fuzz"
version = "0.0.0"
edition = "2021"
publish = false
[package.metadata]
cargo-fuzz = true

[dependencies]
libfuzzer-sys = "0.4"
arbitrary = { version = "1", features = ["derive"] }   # structure-aware inputs
<crate> = { path = "../crates/<crate>" }               # link the SAME graph the real path uses

[lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = ['cfg(fuzzing)'] }

# INVERTED profile — the fuzzer must NOT inherit the ship profile's
# panic="abort"/overflow-checks=false. Turn assertions + overflow checks back
# ON so silent wraps / assertion violations become crash findings.
[profile.release]
debug = 1
debug-assertions = true
overflow-checks = true

[[bin]]
name = "<target>"
path = "fuzz_targets/<target>.rs"
test = false; doc = false; bench = false
```

### A target

```rust
#![no_main]
use libfuzzer_sys::fuzz_target;
use <crate>::decode;   // the untrusted-input entry — decoder / parser / reader

// Feed RAW bytes; do NOT pre-validate UTF-8 — the unchecked paths are exactly
// what we're fuzzing. Finding = panic / abort / overflow / OOM / hang. A
// graceful `Err` (or bounded-then-truncated output on a non-termination guard)
// is a NON-finding.
fuzz_target!(|data: &[u8]| {
    let _ = decode(data);
});
```

If a target relies on `--cfg fuzzing` neutralizing a dangerous side effect
(e.g. envrypt stubs command-substitution under `cfg(fuzzing)`), add a
`#[cfg(not(fuzzing))] compile_error!(...)` so a non-fuzzing build fails loudly
rather than running the side effect on fuzz bytes.

### Toolchain + run

cargo-fuzz needs **nightly** (it sets the sanitizer flags + `--cfg fuzzing`).
The fleet build/updater pin is already a nightly (see `rust-toolchain.toml`;
`rust-toolchain-pins-are-synced` keeps it single-sourced). Install cargo-fuzz
once: `cargo install cargo-fuzz`. `run.sh` is the single source of the
per-target flags so local acceptance and the CI job match:

```bash
fuzz/run.sh <target> [max_total_time_seconds]   # default 600 = 10 min/target
fuzz/run.sh all       [seconds]
```

Handle the shim environment: `cargo +nightly fuzz run` when cargo is the rustup
proxy, else `rustup run nightly cargo fuzz run` (`run.sh` picks). Per-target
flags live in `run.sh`: `-timeout=10` (absorbs the ~10× ASan slowdown; a real
hang is still unbounded), `-rss_limit_mb=2048` (ASan shadow + accumulating
coverage push baseline RSS past 512 MB with no per-exec blowup), `-max_len` to
bound one input, `-dict=fuzz.dict`.

### The `no-unsafe-without-fuzz` gate

envrypt commits `fuzz/no-unsafe-without-fuzz.sh`: any crate that ships `unsafe`
MUST have a fuzz target covering the unsafe path. Wire it into the repo's
`check`/CI so unsafe code can't land unfuzzed. decmpfs (raw attribute streams)
and abitious (hybrid `.node` reader) both have unsafe decode paths — that gate
is the point.

## Escalation

- **ClusterFuzzLite** for continuous CI fuzzing (corpus accretion + coverage +
  bisection) — the biggest lever; adopt before a fancier local engine.
- **bolero** — write ONE harness runnable under libFuzzer / AFL++ / honggfuzz /
  the **Kani** model checker; cheapest way to A/B engines or add bounded proof.
- **arbitrary** derive for structure-aware inputs when raw bytes waste cycles
  rediscovering a valid header/frame.
- **LibAFL** only for a bespoke, long-running campaign that the above can't
  express — heavyweight.
