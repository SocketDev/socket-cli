# no-tsx-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2).

**Trigger:** a Bash command that runs `tsx` or `ts-node` — either as the
binary (`tsx foo.mts`, `tsx watch`, `ts-node script.ts`) or as a Node
loader (`node --import tsx`, `node --loader tsx`, `node --require
ts-node/register`, `node --experimental-loader tsx`, glued `=` forms
included). Detected by AST-parsing the command (`commandsFor`), not a
raw regex.

**Why:** `tsx`/`ts-node` are verboten fleet-wide. The `.node-version`
Node strips TypeScript types natively, so a `.mts`/`.ts` file runs under
`node <file>.mts` with no loader. A TS-loader adds a dependency, a
startup cost, and a second TS-execution semantics that drifts from
production Node. CLAUDE.md already bans `--experimental-strip-types` for
the same reason; this guard closes the loader-shaped hole.

**Fix the message gives:**
- run a script: `node path/to/script.mts`
- hook tests: `node --test test/*.test.mts` (from the hook dir)
- src/repo tests: `node_modules/.bin/vitest run path/to/foo.test.mts`

**Distinct from [`prefer-vitest-guard`](../prefer-vitest-guard/):** that
one steers test RUNNERS to vitest (and rejects `node --test` for
src/repo tests). This guard owns the broader "no tsx/ts-node tool,
ever" rule across all commands, with native-`node` guidance. The narrow
overlap (tsx-as-test-runner) is intentional defense in depth.

**Bypass:** `Allow tsx bypass` typed verbatim in a recent user turn.
