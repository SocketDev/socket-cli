#!/usr/bin/env node
'use strict'

// Hand-written thin loader for the fleet hook dispatch bundle. NOT bundled —
// it stays plain CJS so V8's compile cache reliably caches AND auto-flushes it
// (a type-stripped .mts loader did not auto-flush: a normal exit left zero
// cache files). It turns the compile cache on, pointing at the repo's
// .cache/fleet/fleet-hooks dir, then requires the CJS bundle. The
// dispatcher reads the event from process.argv[2], which settings.json passes
// as `node .../hooks/fleet/index.cjs <Event>`. This loader is hand-written and
// lives ABOVE `_dist/` — that dir holds exclusively build output.
//
// See docs/agents.md/fleet/hook-bundle.md.

const path = require('node:path')
const fs = require('node:fs')

// Resolve the REAL repo root by walking up to the nearest pnpm-workspace.yaml,
// which every fleet repo contains. A fixed `__dirname/../../../..` is correct
// for the live .claude/hooks/fleet/ copy, but the identical
// template/base/ SEED copy resolves 3-up to `template/base/` — so when a test or
// tool executes the seed, enableCompileCache writes a stray
// template/base/.cache — inside the cascade payload. Anchoring at the
// workspace marker keeps the cache in the repo's real root in both cases.
function findRepoRoot(start) {
  let dir = start
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  // No workspace marker (not a fleet checkout): return undefined so the caller
  // SKIPS the compile cache rather than guessing a path. The cache is pure perf
  // — running uncached is correct; writing it to a wrong/brittle location (the
  // `__dirname/../../../..` fallback this replaces) is not.
  return undefined
}

const repoRoot = findRepoRoot(__dirname)

try {
  // enableCompileCache (Node >= 22.8.0) caches the compiled bytecode for every
  // CJS module the bundle pulls in and flushes it on normal exit; the next
  // spawn skips recompilation. The optional call keeps the loader running on
  // older Node (>= 18) where the fn doesn't exist — the cache is pure perf,
  // uncached is correct. Skipped when the repo root is unknown — there is no
  // node_modules to anchor to, and a guessed path is worse than no cache.
  if (repoRoot) {
    require('node:module').enableCompileCache?.(
      path.join(repoRoot, '.cache', 'fleet', 'fleet-hooks'),
    )
  }
} catch {
  // A sandbox that forbids the cache dir: fall through and run the bundle
  // uncached rather than failing the hook.
}

// enableCompileCache (above) only caches modules required AFTER it runs, so it
// MUST precede the first non-builtin require. Keep `./_dist/fleet-pack.cjs` — and every
// other non-builtin require — BELOW this line; only `node:` builtins (path / fs
// / module) may load above.
// Reaches `process.stderr` only when called (bundle-load failure), not at
// module eval — accessing the stream at eval time would capture a TTY/pipe
// handle on every import.
//
// This is the fleet hook-system HEALTH NET, and it lives HERE — in the
// hand-written loader, OUTSIDE `_dist/fleet-pack.cjs` — on purpose: a net that
// detects "the bundle failed to load" cannot live inside the bundle it checks.
// Every dispatched event routes through this loader, so a missing/broken bundle
// means every fleet hook is silently OFF until it is rebuilt (source repo) or
// re-fetched (member). On the SessionStart event the loader ALSO emits a loud,
// actionable notice on Claude Code's SessionStart channel (stdout
// additionalContext) so the failure surfaces in the transcript instead of
// scrolling past as one stderr line; other events stay quiet (one stderr line).
function reportBundleLoadFailure(e) {
  const detail = String(e && e.message ? e.message : e)
  process.stderr.write(
    '[fleet-hook-dispatch] bundle load failed (fail-open): ' + detail + '\n',
  )
  // argv layout: `node .../index.cjs <Event>` — the event is argv[2].
  if (process.argv[2] === 'SessionStart') {
    try {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext:
              '[fleet-hook-dispatch] The fleet hook bundle failed to load — every ' +
              'fleet hook is OFF this session (fail-open). Rebuild it in the ' +
              'wheelhouse with `node scripts/fleet/build-hook-bundle.mts`, or in a ' +
              'member re-fetch the release payload (reinstall / `pnpm run prepare`). ' +
              'Error: ' +
              detail,
          },
        }),
      )
    } catch {
      // Never let the health notice itself wedge the session.
    }
  }
  process.exit(0)
}

try {
  require('./_dist/fleet-pack.cjs')
} catch (e) {
  // Fail-open: a broken/missing bundle must never wedge a tool call.
  // settings.json wires every dispatched event through THIS loader, so a
  // missing bundle means those hooks are silently off until it is rebuilt
  // (source repo) or fetched from the release bundle (member).
  reportBundleLoadFailure(e)
}
