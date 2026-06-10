# Conformance runners

How to author, organize, and maintain runners that exercise a built
artifact against an external spec corpus (tc39/test262, WPT, future
spec suites). This is the fleet canonical layout; references the
[`running-test262`](../../../.claude/skills/running-test262/SKILL.md)
skill for invocation specifics.

## The 4-tier layout

```
packages/<pkg>/
  test/
    fixtures/<corpus>/                # 1. Sparse-checkout submodule
    scripts/<corpus>-<scope>-runner.mts  # 2. Thin CLI entry
    scripts/<corpus>/                 #    Modular guts:
      types.mts                       #      Result / Test / Summary
      parser.mts                      #      Frontmatter parser
      classifier.mts                  #      Pure: result + allowlist → bucket
      harness.mts                     #      Compose harness + walk corpus
      executor.mts                    #      Spawn + collect + retry
      report.mts                      #      Format summary
    integration/<corpus>-<scope>.test.mts  # 3. Vitest wrapper (gate)
    unit/<corpus>-<scope>.test.mts    # 4. Vitest tests of pure modules
  <corpus>-config/<corpus>.allowlist  # 5. Out-of-band allowlist file
  package.json scripts:
    "<corpus>:<scope>": "node test/scripts/<corpus>-<scope>-runner.mts"
```

### 1. Sparse submodule

External corpora live at `test/fixtures/<corpus>/`, NOT `upstream/`.
Build-time submodules use `upstream/`; test-time corpora use
`test/fixtures/`. The distinction signals whether bumping the
submodule affects shipped artifacts. See related
[`../fleet/untracked-by-default.md`](untracked-by-default.md) for
adjacent rules on vendored trees.

Conformance corpora are large but our runners exercise narrow
subtrees. Add a `sparse-checkout = <patterns>` field to `.gitmodules`
and use `scripts/fleet/git-partial-submodule.mts clone <path>` for fresh
checkouts. Vanilla `git submodule update` ignores the field; the
fleet utility reads it.

Examples:

```ini
# .gitmodules
[submodule "packages/node-smol-builder/test/fixtures/wpt/streams"]
    path = packages/node-smol-builder/test/fixtures/wpt/streams
    url = https://github.com/web-platform-tests/wpt.git
    sparse-checkout = streams/

[submodule "packages/temporal-infra/test/fixtures/test262"]
    path = packages/temporal-infra/test/fixtures/test262
    url = https://github.com/tc39/test262.git
    sparse-checkout = test/built-ins/Temporal/ test/intl402/Temporal/ harness/
```

Requires git ≥ 2.27 (for `--filter` + `--sparse` on `git clone`).

### 2. Runner: thin entry + modular guts

The CLI entry (`<corpus>-<scope>-runner.mts`) stays under ~60 lines. It parses argv, resolves the binary, calls the harness/executor modules. Everything else lives in the sibling `<corpus>/` directory broken into ~6 modules. The split lets each piece have a single reason to change AND lets the pure modules be unit-tested in isolation.

Canonical module set:

| Module           | Responsibility                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| `types.mts`      | `Result`, `Test`, `Summary`, `TestCase` types                           |
| `parser.mts`     | Frontmatter / metadata parsing                                          |
| `classifier.mts` | Pure: `(result, allowlist) → "expected" / "unexpected" / "now-passing"` |
| `harness.mts`    | Compose harness JS, walk corpus, filter                                 |
| `executor.mts`   | Spawn subprocesses, collect output, retry                               |
| `report.mts`     | Format human-readable summary, exit-code policy                         |

**The classifier is the highest-value module to extract.** Get the result-bucketing logic wrong and the runner silently masks regressions. Keep it pure (no I/O, no globals).

**Run tests via `<binary> -e <composed script>`, not by loading an `.mjs` entry file.** The runner CLI + its `<corpus>/` modules run on the host's modern Node, so they're `.mts`. To run a test _inside the built binary_ (e.g. a custom Node built `--without-amaro`, which strips out TypeScript support), compose one self-contained script in the `.mts` executor — harness text + the test's META scripts + the test source + a run epilogue, joined with newlines — and pass it via `<binary> -e <script>`. The executor reads each piece with `readFileSync`, so the harness lives as plain `.js`/`.cjs` _text_ that's concatenated, never resolved as a module. Nothing the binary loads is `.mts`, so its no-type-stripping limit never bites, and everything author-side stays `.mts` with lint + highlighting. test262 (`composeScript` → `binary -e`) and socket-btm's WPT streams runner both use this shape.

Avoid spawning a persisted `.mjs` _entry file_ inside the binary. If you ever must (a test genuinely needs to be the module entry point, not concatenated text), that file **must** stay `.mjs` — the `--without-amaro` runtime can't parse `.mts` — with a top-of-file comment saying why, so a future "convert .mjs → .mts" sweep doesn't break it. socket-btm's `smol-manifest-*-live.mjs` drivers are the remaining example. Prefer the `-e` shape; it's strictly friendlier.

### 3. Integration vitest wrapper (auto-gate)

A ~20-line `.test.mts` under `test/integration/` that:

1. Resolves the built binary (returns `undefined` if no build exists).
2. Computes `skipIf` from that.
3. Inside `describe.skipIf(...)`, has one `it()` that spawns the
   runner subprocess and asserts exit code 0.

```ts
// test/integration/<corpus>-<scope>.test.mts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { resolveFinalBinary } from '../helpers/binary.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.resolve(
  __dirname,
  '..',
  'scripts',
  '<corpus>-<scope>-runner.mts',
)
const skipTests = !resolveFinalBinary()
const TIMEOUT_MS = 45 * 60 * 1000

describe.skipIf(skipTests)('<corpus> <scope> conformance', () => {
  it(
    'no unexpected failures vs allowlist',
    async () => {
      const result = await spawn('node', [RUNNER], { stdio: 'inherit' })
      expect(result.code).toBe(0)
    },
    TIMEOUT_MS,
  )
})
```

This is what brings the gate into `pnpm test`. Without it, the runner
is a manual ritual the dev has to remember.

### 4. Unit tests for the pure modules

A `.test.mts` under `test/unit/` covering the classifier exhaustively.
At minimum: every transition (success/failure × allowed/disallowed),
stale-allowlist (test passes that's in the allowlist), and
prefix-match edge cases.

These tests do NOT spawn subprocesses, do NOT walk the corpus, and do
NOT need the built binary. Pure logic only. They catch the highest-
severity bug class (silent regression masking) without needing the
expensive infrastructure.

### 5. Allowlist file

Either path-keyed or feature-keyed depending on what the runner
exercises:

- **Path-keyed**: `<file> (<scenario>)` one per line, with comment
  rationale. Suitable for narrow subset runs (temporal-infra Temporal
  subset, WPT streams). Allow only failures that can be justified.
- **Feature-keyed**: TC39 feature name (`decorators`,
  `import-source`). Suitable for broad parser conformance where the
  set of unimplemented features is well-defined (ultrathink/acorn
  parsers). Makes it hard to sneak a parser bug past the allowlist.

**Never inline a Map literal** in the runner source. The diff becomes
unreviewable, the allowlist mixes with logic, and PRs that touch the
runner accidentally pull in allowlist changes.

## Authoring a new conformance runner

Use this checklist:

1. Submodule at `test/fixtures/<corpus>/` with `sparse-checkout`
   declared in `.gitmodules`.
2. Runner skeleton at `test/scripts/<corpus>-<scope>-runner.mts`
   that imports from `test/scripts/<corpus>/{parser,classifier,
harness,executor,report}.mts`.
3. Allowlist file at `<corpus>-config/<corpus>.allowlist` (path- or
   feature-keyed).
4. Vitest integration wrapper at
   `test/integration/<corpus>-<scope>.test.mts`.
5. Vitest unit tests at `test/unit/<corpus>-<scope>.test.mts`
   covering at minimum the classifier.
6. `package.json` script: `"<corpus>:<scope>": "node test/scripts/<corpus>-<scope>-runner.mts"`.

The runner should always exit non-zero on (a) unexpected failure (test not in allowlist that failed), or (b) stale allowlist (test in allowlist that now passes; a drift signal that needs cleanup, not silent acceptance).

## Reference implementations

As of 2026-05, the closest-to-canonical implementations in the fleet:

- `socket-btm/packages/temporal-infra/test/scripts/test262-temporal-runner.mts`: best module split + unit-tested classifier.
- `socket-btm/packages/node-smol-builder/test/scripts/wpt-streams-runner.mts`: best integration wrapper shape.

When in doubt, mirror temporal-infra's `test262/` subdirectory split.

## Anti-patterns

- **Inline `EXPECTED_FAILURES` Map** in the runner source. Move it to
  an external allowlist file.
- **Single 500+ line monolith**. Split into the canonical 6 modules
  the first time you touch it.
- **Vitest wrapper that runs the corpus inline as `test.each(files)`**.
  Each file is too granular for vitest's reporter and breaks
  allowlist classification semantics. Spawn the runner as a subprocess
  and check exit code; the runner's own report is the human-readable
  output.
- **Test-time submodule under `upstream/`**. That path is reserved for
  build-time submodules. Move conformance corpora to
  `test/fixtures/<corpus>/`.
- **Full-tree submodule when only a subset is exercised**. Use
  sparse-checkout.

## Related skills + docs

- `.claude/skills/running-test262/SKILL.md`: how to invoke runners per repo.
- [`untracked-by-default.md`](untracked-by-default.md): adjacent rules for vendored / build-copied trees.
- [`parser-comments.md`](parser-comments.md): lock-step comment conventions for cross-language parser ports (relevant when a single package has multiple language lanes, each with its own runner).
