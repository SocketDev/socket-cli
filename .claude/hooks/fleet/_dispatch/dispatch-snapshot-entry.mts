/*
 * @file The V8-startup-snapshot build entry for the fleet hook dispatcher.
 *
 *   This is the snapshot sibling of `dispatch-entry.mts`. Where the normal
 *   entry calls `runDispatcherCli()` UNCONDITIONALLY at module eval (the
 *   `index.cjs` loader + compile-cache path), this entry does ZERO per-run work
 *   at module eval. Built with `node --build-snapshot`, it:
 *
 *     1. At MODULE EVAL (the snapshot build pass): imports the static dispatch
 *        table + the pure `dispatch()` closure (heap state worth freezing) and
 *        registers a deserialize-main fn. Nothing reads stdin/argv/env/cwd, no
 *        Date.now()/Math.random(), no timers, no pending promise — so the build
 *        pass is SYNCHRONOUS and snapshot-clean.
 *     2. When BOOTING FROM THE BLOB (`node --snapshot-blob … <Event>`): the
 *        deserialize-main fn runs. ALL per-run work lives here — read the event
 *        arg, drain stdin, JSON.parse, run the hooks, surface output, exit.
 *
 *   ARGV LAYOUT GOTCHA: a snapshot-booted process has NO script path in argv
 *   (the "script" is the frozen blob), so the event arg is `process.argv[1]`,
 *   NOT `process.argv[2]` like the normal `node index.cjs <Event>` path. The
 *   deserialize-main reads argv[1].
 *
 *   The blob is Node-major + platform specific; the loader that picks the blob
 *   vs the index.cjs/compile-cache fallback gates on a (node-major × platform)
 *   match with fail-open — see snapshot-loader.cjs.
 */

// Load first: installs ES built-ins missing below Node 20 (sync defineProperty,
// snapshot-clean) so a blob built on an older Node — and the bundle fallback —
// runs on Node ≥18. Feature-detected → no-op where native.
import '../_shared/es-polyfills.mts'

import process from 'node:process'
import v8 from 'node:v8'

import { dispatch } from './dispatch.mts'
import type { DispatchPayload } from './dispatch.mts'

// FULL COVERAGE (190/190 in ONE bundle): every candidate hook is now frozen into
// the snapshot, so the prior hybrid's runtime `loadBundleB()` is gone — there is
// no second bundle to splice in; the frozen `dispatch()` runs the whole set. The
// 8 acorn-WASM guards (now frozen in bundle A) require `./acorn-bindgen.cjs` at
// RUNTIME via a bundled createRequire whose anchor resolves (through the frozen
// build-time `__filename`) to this `_dispatch/` dir, and the bindgen reads
// `acorn.wasm` from alongside it — the build step copies both artifacts here.

/**
 * Drain stdin to a string. Local to the deserialize-main path — the snapshot
 * build pass must NEVER touch stdin (a pending read = a pending promise = a
 * build-constraint violation). Mirrors the shared `readStdin`, inlined here so
 * the build entry has zero module-eval I/O wiring.
 */
function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => {
      resolve(buf)
    })
    process.stdin.on('error', () => {
      resolve(buf)
    })
  })
}

/**
 * The runtime entry: everything per-run lives here, run only when booting from
 * the blob. Reads the event from argv[1] (snapshot argv layout), drains stdin,
 * dispatches, surfaces reminders/blocks, exits. Fail-open on every error.
 */
async function deserializeMain(): Promise<void> {
  // Snapshot argv layout: [nodeBinary, <Event>] — no script path. The event is
  // at argv[1], not argv[2].
  const event = process.argv[1]
  if (!event) {
    process.exit(0)
  }
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw.trim()) {
    process.exit(0)
  }
  let payload: DispatchPayload
  try {
    payload = JSON.parse(raw) as DispatchPayload
  } catch {
    process.exit(0)
  }
  let result
  try {
    result = await dispatch(event, payload)
  } catch {
    process.exit(0)
  }
  if (result.reminders.length) {
    process.stderr.write(result.reminders.join('\n') + '\n')
  }
  if (result.decision === 'block' && result.blockReason !== undefined) {
    if (payload.tool_name === undefined) {
      process.stdout.write(
        JSON.stringify({ decision: 'block', reason: result.blockReason }),
      )
      process.exit(0)
    }
    process.exit(2)
  }
  process.exit(0)
}

// Register the runtime entry with V8's snapshot machinery, but only during a
// build pass. When this module is ever run WITHOUT --build-snapshot (e.g. a
// dev sanity check), fall back to running deserializeMain directly so the
// entry is still exercisable outside the snapshot flow.
if (v8.startupSnapshot.isBuildingSnapshot()) {
  v8.startupSnapshot.setDeserializeMainFunction(() => {
    void deserializeMain()
  })
} else {
  void deserializeMain()
}
