# Lint parity across languages

The fleet's `socket/*` doctrine isn't JS-specific. The same rules that the
oxlint plugin enforces on TypeScript apply to **Rust, Go, and C++** fleet code —
delivered **hybrid**: each language's native linter carries the rules it can
express, and one shared fleet check-script carries the language-agnostic doctrine
no linter can.

## The rule

- **Native linter for what it can express.** clippy (`clippy.toml` +
  `[lints]`), golangci-lint (`.golangci.yml`), and clang-tidy (`.clang-tidy`)
  are the fleet baselines — cascaded from `template/base`. Port the doctrine into
  their config where they support it, don't reinvent it:
  - `no-boolean-trap-param` → clippy `max-fn-params-bools = 1`, revive
    `flag-parameter`.
  - `no-process-chdir` / `no-process-cwd-in-scripts-hooks` → clippy
    `disallowed-methods` (`std::env::set_current_dir`/`current_dir`), golangci
    `forbidigo` (`os.Chdir`).
  - `no-console-prefer-logger` → golangci `forbidigo` (`fmt.Print*`).

- **Shared check-script for the rest.** The language-agnostic doctrine —
  `inclusive-language`, `no-status-emoji`, `no-placeholders` /
  `personal-path-placeholders`, `no-private-path-in-source`,
  `no-malformed-bypass-marker`, `max-file-lines` — is enforced across `.rs` /
  `.go` / `.c*` / `.h*` by one fleet check-script, not three custom-lint
  frameworks. One scanner, all languages: DRY, and it can't drift between them.

- **Don't port JS-only rules.** The `vitest-*`, `no-default-export`,
  `no-namespace-import`, `no-promise-race`, `no-top-level-await`, ESM /
  dynamic-import, and `structured-clone` rules have no cross-language meaning —
  leave them in the oxlint plugin.

- **The Rust deny-set lives in `Cargo.toml`, not clippy.toml.** clippy.toml only
  holds thresholds + disallowed APIs; the lint levels go in each crate:

  ```toml
  [lints.rust]
  unsafe_code = "forbid"
  unexpected_cfgs = { level = "warn", check-cfg = ['cfg(coverage)', 'cfg(coverage_nightly)'] }

  [lints.clippy]
  all = { level = "deny", priority = -1 }
  ```

## Coverage: don't chase the tool's artifacts

Fleet Rust coverage runs through the pinned nightly (`cargo llvm-cov`) so the
`#[cfg_attr(coverage_nightly, coverage(off))]` markers on genuinely un-runnable
I/O glue (real browser/webview, raw-terminal event loops, global-logger init,
system clipboard) are honored — and only those.

- **`coverage(off)` is for I/O that can't run in a unit test, not for logic.**
  Marking testable code off to inflate the number is a false corner-cut. If it's
  reachable, test it (inject the seam — `Transport`/`Prompt`/`Io`/`Launcher` — and
  mock it) instead.

- **Never rewrite early-returns to single-exit to satisfy coverage.** A closing
  `}` after a `return` is its own llvm-cov *region*; the early return skips it, so
  it shows uncovered. This is a tooling artifact, **not** a runtime cost —
  release codegen is identical either way. Contorting guard clauses into a
  `let mut result = …; result` accumulator to color that brace green trades real
  readability (and bug-surface) for a cosmetic metric. ~99% with all *logic*
  covered is the honest ceiling; the residue is brace-regions, unreachable
  defensive arms, and non-deterministic fuzz asserts.

## Why

The doctrine is about *code*, not *syntax* — a boolean trap, a process-global
chdir, a status emoji in a comment are equally wrong in Rust, Go, or C++. Encoding
each rule once (native config where it fits, one shared scanner for the rest)
keeps the fleet consistent across languages without three parallel rule sets to
drift. And a coverage number is only worth chasing up to where it still reflects
tested behavior — past that it measures the tool, not the code.
