// Sidecar shipped by codex-1.0.1-stdin-eagain.patch (socket-wheelhouse).
//
// Robust synchronous stdin read for Claude Code hooks. The plugin's hooks
// originally did `fs.readFileSync(0, "utf8")`, which throws EAGAIN the instant
// Claude Code hands the hook a non-blocking stdin pipe (O_NONBLOCK set) with no
// bytes buffered yet. This reads in a loop instead, sleeping ~2ms on EAGAIN
// (Atomics.wait blocks the thread without a busy spin) until EOF.
//
// Kept as a standalone module — not inlined into the patch — so the patch's
// diff footprint stays tiny (an import + two call-site swaps). The reapply step
// in install-claude-plugins.mts copies this file into the cache before applying
// the diff. Provenance + lifecycle: docs/agents.md/fleet/plugin-cache-patches.md.

import fs from 'node:fs'

export function readStdinSync() {
  const chunks = []
  const buf = Buffer.alloc(65536)
  for (;;) {
    let bytesRead
    try {
      bytesRead = fs.readSync(0, buf, 0, buf.length, null)
    } catch (e) {
      if (e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK')) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
        continue
      }
      if (e && e.code === 'EOF') {
        break
      }
      throw e
    }
    if (bytesRead === 0) {
      break
    }
    chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
  }
  return Buffer.concat(chunks).toString('utf8')
}
