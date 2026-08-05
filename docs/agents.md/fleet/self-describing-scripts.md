# Self-describing scripts: `--describe` and `-h`/`--help`

Every fleet/repo CLI entry script answers two questions without being read or
run: `--describe` prints its one-line purpose and `-h`/`--help` prints its
usage. Both are intercepted by the shared entry runner BEFORE `main()` runs —
no lock taken, no side effect — so a help request is always safe, even against
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

- `describe` — one line, starts lowercase, no trailing period, what the
  script does. `--describe` prints it verbatim; script inventories and agents
  read it without opening the file.
- `help` — opens with a `Usage:` line naming the sanctioned invocation
  (`node scripts/...` or the `pnpm run` form where that is the documented
  entry), then one short line per flag `main()` actually parses. `--help`
  prints `describe`, a blank line, then `help`.
- `--describe` wins when both flags are present; a help request also beats
  the bare-`--` refusal.

## Rules

- The meta lives at the call site as a module-level `SCRIPT_META` const (or an
  existing exported usage const passed as `help`). Never duplicate usage text
  inside `main()` — the runner owns the interception, so in-main `-h`/`--help`
  handling is deleted, not kept as a fallback.
- Wrappers that forward argv to a child tool still self-describe; the fleet's
  own usage line is the answer, and it is the right place to document the
  wrapper's conventions.
- A genuinely incompatible entry goes on the check's documented allowlist with
  a reason, never silently skipped.

## Enforcement

`scripts/fleet/check/entry-scripts-self-describe.mts` scans every `.mts`
under `scripts/fleet/` + `scripts/repo/` and flags:

1. **no-run-main** — an entry-guarded script that never calls the shared
   runner (a help request would run the side effect).
2. **no-meta** — a `runMain(...)` call with no ScriptMeta second argument
   (the runner has nothing to print). TypeScript enforces the meta's shape
   once it is passed.

The check runs in the standard `pnpm run check` path wiring beside
`entry-scripts-are-fail-soft`.
