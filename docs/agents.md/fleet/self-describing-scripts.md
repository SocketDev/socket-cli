# Self-describing scripts: `--describe` and `-h`/`--help`

Every fleet/repo CLI entry script answers two questions without being read or
run: `--describe` prints its one-line purpose and `-h`/`--help` prints its
usage. Both are intercepted by the shared entry runner BEFORE `main()` runs -
no lock taken, no side effect - so a help request is always safe, even against
a destructive script or while another holder has the repo lock.

## The seam

`scripts/fleet/_shared/run-main.mts` exports the runner and the meta shape:

```ts
interface ScriptMeta {
  readonly describe: string
  readonly help: string
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
```

- `describe` - one line, starts lowercase, no trailing period, what the
  script does. `--describe` prints it verbatim; script inventories and agents
  read it without opening the file.
- `help` - opens with a `Usage:` line naming the sanctioned invocation
  (`node scripts/...` or the `pnpm run` form where that is the documented
  entry), then one short line per flag `main()` actually parses. `--help`
  prints `describe`, a blank line, then `help`.
- `--describe` wins when both flags are present; a help request also beats
  the bare-`--` refusal.

## Rules

- The meta lives at the call site as a module-level `SCRIPT_META` const (or an
  existing exported usage const passed as `help`). Never duplicate usage text
  inside `main()` - the runner owns the interception, so in-main `-h`/`--help`
  handling is deleted, not kept as a fallback.
- Wrappers that forward argv to a child tool still self-describe; the fleet's
  own usage line is the answer, and it is the right place to document the
  wrapper's conventions.
- A genuinely incompatible entry goes on the check's documented allowlist with
  a reason, never silently skipped.

## The new-script contract

Every NEW `.mts` script - onboarding steps, a skill's or hook's backing
script, a codified check - is born meeting all four of these, not retrofitted
later:

1. **Self-describes through the shared runner.** The entry is
   `runMain(main, SCRIPT_META)`; `--describe` and `-h`/`--help` answer before
   any side effect.
2. **Has a unit test.** Mirror-named under `test/repo/unit/`, exercising the
   exported pure functions; `entry-scripts-are-born-tested` enforces this for
   repo-owned entries (pre-contract scripts ride its script-owned
   `--update-baseline` ratchet).
3. **One path, one reference.** Every filesystem path is constructed exactly
   once in the package's own `paths.mts` and imported from there - never
   respelled inline (`path-hygiene`).
4. **The script IS the law.** A discipline lives in the runnable `.mts` (plus
   its check/hook registration), never only in prose or a skill's markdown
   (`code-is-law`); skills and commands stay thin wrappers over it.

## Enforcement

`scripts/fleet/check/entry-scripts-are-self-describing.mts` scans every `.mts`
under `scripts/fleet/` + `scripts/repo/` and flags:

1. **no-run-main** - an entry-guarded script that never calls the shared
   runner, so a help request runs the side effect.
2. **no-meta** - a `runMain(...)` call with no ScriptMeta second argument,
   leaving the runner nothing to print. TypeScript enforces the meta's shape
   once it is passed.
3. **runs-on-import** - a script that starts its own pipeline from a
   top-level statement (`main()`, `void main()`, `await main()`,
   `export const run = main().catch(…)`). Nothing gates on argv, so the work
   is already done by the time a help request could be read, and importing
   the module as a library runs it too. Defects 1 and 2 both need an entry
   guard to inspect, so a file with no guard at all used to read as "a
   library, out of scope" and pass: `node scripts/fleet/update.mts
   --describe` ran a full taze update plus `pnpm install` and rewrote four
   tracked files. Keep the work inside `main`, export it for the tests, and
   end the file with the guard.

The check runs in the standard `pnpm run check` path wiring beside
`entry-scripts-are-fail-soft`.
