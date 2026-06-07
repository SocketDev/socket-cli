# target-arch-env-guard

PreToolUse Edit/Write hook that blocks builder scripts that read
`process.env.TARGET_ARCH` and later spawn `make` / `configure`
without first `delete process.env.TARGET_ARCH`.

## Why

GNU make's built-in implicit rule for `%.o : %.c` is:

    $(CC) $(CFLAGS) $(CPPFLAGS) $(TARGET_ARCH)

`TARGET_ARCH` is a standard make recipe variable historically used
for `-m64`-style flags. When set as an environment variable, make
picks it up as a make variable and **appends it to the gcc command
line**. The fleet's builder scripts read `TARGET_ARCH` as their own
input (typically `"x64"` / `"arm64"`), which gcc then interprets as
a positional source-file argument:

    gcc: error: x64: linker input file not found

**Why:** when a workflow sets `TARGET_ARCH: ${{ matrix.arch }}` and a
make-driven builder script inherits it, every Linux + darwin platform
red-lines at `make` because gcc treats the arch string as a source-file
argument. The fix is a single line — read the value, then drop it from
the spawned env:

    const TARGET_ARCH = process.env.TARGET_ARCH || process.arch
    delete process.env.TARGET_ARCH

CMake-driven builders (lief, curl, boringssl) are immune because
CMake generates explicit per-target compile commands and never
falls through to make's implicit rules.

## What it blocks

The hook fires when an Edit/Write to a file under `packages/*/scripts/`
or `scripts/` does ALL of:

1. References `process.env.TARGET_ARCH` (read or assignment) AND
2. Spawns `make` (any of `spawn('make'`, `execSync('make`,
   `'make '` literal in a command array, `pnpm exec make`,
   `pnpm run make`, `npm run make`) OR a `configure` script
   (`./configure`, `bash configure`), AND
3. Does NOT contain `delete process.env.TARGET_ARCH` anywhere in
   the after-text.

The check is conservative — it errs toward false-negatives (allow
edits the hook can't classify) over false-positives.

## Bypass

Type the canonical phrase in a new message:

    Allow target-arch-env bypass

Legitimate case: a script that intentionally forwards
`TARGET_ARCH` to make as a make variable (rare; cite the upstream
Makefile's use of `$(TARGET_ARCH)` in a comment).

## Fix

```ts
const TARGET_ARCH = process.env.TARGET_ARCH || process.arch
delete process.env.TARGET_ARCH

await spawn('make', [...args], { env: process.env })
```

Or scope the delete to the spawn:

```ts
const childEnv = { ...process.env }
delete childEnv.TARGET_ARCH
await spawn('make', [...args], { env: childEnv })
```

Both patterns pass the hook (the regex looks for
`delete process.env.TARGET_ARCH` OR `delete .*\.TARGET_ARCH`).
