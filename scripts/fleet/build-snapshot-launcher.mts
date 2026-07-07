#!/usr/bin/env node
/*
 * @file Build the NATIVE per-platform launcher for the snapshot dispatcher.
 *   SPIKE (spike/snapshot-hooks).
 *
 *   The only shippable snapshot invocation WITHOUT a native launcher is
 *   `snapshot-loader.cjs`, which boots a FULL node solely to `spawnSync` a
 *   SECOND `node --snapshot-blob …` — a two-process tax (~30 ms over
 *   snapshot-direct) that erases the snapshot's win. The launcher removes it:
 *
 *     - POSIX (mac, linux): `dispatch-launcher.c` re-execs node in ONE process
 *       transition (`execv` REPLACES the launcher image — no parent node, no
 *       fork, no wait, no second resident process). Measured ~1.4 ms intrinsic
 *       overhead over a bare `execv`, ≈ snapshot-direct, ~1.25× faster than the
 *       two-process loader on mac; the warm win holds on linux (arm64 1.31×,
 *       x64 1.36× vs coverage-matched compile-cache index.cjs — Docker-measured).
 *     - WINDOWS (`dispatch-launcher-win.c`): Windows has no image-replacing
 *       execv, so the launcher `CreateProcess`es node, `WaitForSingleObject`s,
 *       and propagates the exit code (a thin native parent that only waits). It
 *       still removes the loader's full PARENT-node startup (two node processes
 *       → one node + a ~150 KB native parent). Whether that preserves the win is
 *       a Windows-CI question (CreateProcess is heavier than execv and the thin
 *       parent stays resident) — see the build note below. Correctness is
 *       guaranteed on every platform by the total fail-open to index.cjs.
 *
 *   It also writes the two build-time-FROZEN sidecars the launcher reads
 *   (mirroring `dispatch-snapshot-entry.mts`'s DISPATCH_DIR_FROZEN model):
 *     - node.path           abs path to the node binary that built the blob
 *     - snapshot-blob.path  abs path to the current blob (runtime+content keyed)
 *   so the launcher resolves the fast path with two small reads instead of
 *   re-deriving the node-ver × arch × v8tag × uid × content-hash key in C.
 *
 *   HOST-ONLY by default: this builds the launcher for the HOST os/arch (the
 *   binary + sidecars are machine/runtime-specific and gitignored). The C
 *   sources — `dispatch-launcher.c` (POSIX) and `dispatch-launcher-win.c`
 *   (Windows) — are the committed source of truth. The non-host platforms are
 *   built in CI / Docker; `--print-build` documents the exact incantations.
 *
 *   PREREQUISITE for the host build: run `build-hook-snapshot.mts` first (this
 *   reads the blob it produced).
 *
 *   Usage:
 *     node scripts/fleet/build-snapshot-launcher.mts              # build for host
 *     node scripts/fleet/build-snapshot-launcher.mts --print-build  # show the
 *                                                                   #   per-platform
 *                                                                   #   Docker/CI recipe
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { DISPATCH_DIR } from './make-hook-dispatch.mts'

const require = createRequire(import.meta.url)
const { blobPath } = require(
  path.join(DISPATCH_DIR, 'snapshot-cache-path.cjs'),
) as { blobPath: (entryId: string, sourceHash: string) => string }

const POSIX_SRC = path.join(DISPATCH_DIR, 'dispatch-launcher.c')
const WIN_SRC = path.join(DISPATCH_DIR, 'dispatch-launcher-win.c')
const SNAPSHOT_BUNDLE = path.join(DISPATCH_DIR, 'snapshot-bundle.cjs')

/**
 * Per-platform build recipe. The HOST row is what `main()` runs; the others are
 * the Docker/CI incantations (documented, not executed here) that produce the
 * launcher for a non-host target. Cross-compiling the WINDOWS launcher is done
 * with mingw from a POSIX host (proven: PE32+ x64 + PE32 i686 both build); the
 * arm64-windows target has no mingw toolchain and is built on the
 * `windows-latest` CI runner (MSVC `cl`) or a win-arm64 cross-SDK.
 */
const BUILD_RECIPE = `
Per-platform snapshot-launcher build
=====================================

The C sources are committed; the binaries + sidecars are gitignored,
machine/runtime-specific, and built per target. Each target needs (1) the
matching node that builds + boots the blob, (2) a C compiler for that target,
(3) the snapshot blob (build-hook-snapshot.mts under that target's node).

HOST (mac/linux/windows): this script auto-detects and builds for the host.

  node scripts/fleet/build-hook-snapshot.mts        # build the blob (host node)
  node scripts/fleet/build-snapshot-launcher.mts    # build the host launcher

--- POSIX cross/CI targets (dispatch-launcher.c, execv) ---

darwin-arm64 / darwin-x64 (from a mac host — fat universal in one cc):
  cc -O2 -arch arm64 -arch x86_64 -o dispatch-launcher dispatch-launcher.c

linux-x64  (Docker, native on an amd64 runner; QEMU on an arm64 host):
  docker run --rm --platform linux/amd64 -v "$DISPATCH":/d node:22-bookworm \\
    bash -c 'apt-get update -qq && apt-get install -y -qq gcc &&
             cc -O2 -o /d/dispatch-launcher /d/dispatch-launcher.c'

linux-arm64  (Docker, native on an arm64 runner):
  docker run --rm --platform linux/arm64 -v "$DISPATCH":/d node:22-bookworm \\
    bash -c 'apt-get update -qq && apt-get install -y -qq gcc &&
             cc -O2 -o /d/dispatch-launcher /d/dispatch-launcher.c'

  (musl: node:22-alpine + apk add gcc musl-dev.)

--- Windows targets (dispatch-launcher-win.c, CreateProcess + wait) ---

win32-x64  (mingw cross from a POSIX host — PROVEN):
  x86_64-w64-mingw32-gcc -O2 -municode -DUNICODE -D_UNICODE \\
    -o dispatch-launcher.exe dispatch-launcher-win.c

win32-x86  (mingw cross):
  i686-w64-mingw32-gcc   -O2 -municode -DUNICODE -D_UNICODE \\
    -o dispatch-launcher.exe dispatch-launcher-win.c

win32-arm64  (NO mingw toolchain on a typical posix host -> build on the
  windows-latest CI runner with MSVC, or a win-arm64 cross-SDK):
  cl /O2 /DUNICODE /D_UNICODE dispatch-launcher-win.c /Fe:dispatch-launcher.exe ^
     kernel32.lib

PERF NOTE (Windows): the native launcher removes the loader's full PARENT-node
startup, but — unlike POSIX execv — it does NOT eliminate the parent process; it
stays resident waiting on the CreateProcess child. Whether the cheap native
parent-wait preserves the snapshot win or Windows process-creation reintroduces
the tax is CI-confirm-only (no Windows on the build host). If CI shows the win
does NOT hold, Windows takes the compile-cache fallback (point settings.json at
\`node index.cjs <Event>\`) — correctness is identical, the snapshot is dropped
only as the perf path. Fail-open guarantees correctness on every platform.
`.trim()

/**
 * Host C-compile of the right source for this os/arch.
 */
function buildHostLauncher(): boolean {
  const isWin = process.platform === 'win32'
  const src = isWin ? WIN_SRC : POSIX_SRC
  const outBin = path.join(
    DISPATCH_DIR,
    isWin ? 'dispatch-launcher.exe' : 'dispatch-launcher',
  )
  if (!existsSync(src)) {
    process.stderr.write(`launcher source missing: ${src}\n`)
    return false
  }

  let cc: string
  let args: string[]
  if (isWin) {
    // The host build on Windows uses whatever C compiler is on PATH. mingw gcc
    // is the simplest; MSVC `cl` is the CI default. Prefer gcc if present.
    const haveGcc =
      spawnSync('gcc', ['--version'], { stdio: 'ignore' }).status === 0
    if (haveGcc) {
      cc = 'gcc'
      args = ['-O2', '-municode', '-DUNICODE', '-D_UNICODE', '-o', outBin, src]
    } else {
      cc = 'cl'
      args = [
        '/O2',
        '/DUNICODE',
        '/D_UNICODE',
        src,
        `/Fe:${outBin}`,
        'kernel32.lib',
      ]
    }
  } else {
    cc = 'cc'
    args = ['-O2', '-o', outBin, src]
  }

  const r = spawnSync(cc, args, { stdio: 'inherit' })
  if (r.status !== 0 || !existsSync(outBin)) {
    process.stderr.write(`${cc} failed (exit ${String(r.status)}).\n`)
    return false
  }
  process.stdout.write(`Built ${outBin}\n`)
  return true
}

/**
 * Freeze node.path + snapshot-blob.path next to the launcher.
 */
function writeSidecars(): void {
  const sourceHash = crypto
    .createHash('sha256')
    .update(readFileSync(SNAPSHOT_BUNDLE))
    .digest('hex')
    .slice(0, 16)
  const blobOut = blobPath('dispatch', sourceHash)
  writeFileSync(path.join(DISPATCH_DIR, 'node.path'), `${process.execPath}\n`)
  writeFileSync(path.join(DISPATCH_DIR, 'snapshot-blob.path'), `${blobOut}\n`)
  process.stdout.write(
    `  node.path=${process.execPath}\n  snapshot-blob.path=${blobOut}\n`,
  )
}

function main(): void {
  if (process.argv.includes('--print-build')) {
    process.stdout.write(BUILD_RECIPE + '\n')
    return
  }
  if (!existsSync(SNAPSHOT_BUNDLE)) {
    process.stderr.write(
      'snapshot-bundle.cjs missing — run build-hook-snapshot.mts first.\n',
    )
    process.exitCode = 2
    return
  }
  if (!buildHostLauncher()) {
    process.exitCode = 1
    return
  }
  writeSidecars()
  process.stdout.write(
    `\nNon-host platforms are built in Docker/CI — run with --print-build for the recipe.\n`,
  )
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
