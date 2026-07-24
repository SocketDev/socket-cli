#!/usr/bin/env node
'use strict'

// Hook-dispatch SNAPSHOT loader. SPIKE (spike/snapshot-hooks).
//
// settings.json points the hook command here: `node .../snapshot-loader.cjs
// <Event>`. The loader resolves the V8 startup-snapshot blob for THIS runtime
// and THIS bundle (snapshot-cache-path.cjs keys it the way Node keys its compile
// cache — node version × arch × V8 tag × uid — plus the bundle's content hash)
// and re-execs node booting from it, so the dispatcher runs from the frozen heap
// (no parse/compile/instantiate). When no matching blob exists (different
// runtime, never primed for this member, or the bundle changed since the last
// build), it FAILS OPEN to the compile-cache `index.cjs` path, which is correct
// everywhere. The blob is a pure startup optimization; its absence is never an
// error.
//
// WHY a re-exec and not require(blob): a V8 startup snapshot is consumed by the
// `--snapshot-blob` process FLAG, not by `require`. So the loader spawns a
// child `node --snapshot-blob <blob> <Event>` with stdin/stdout/stderr
// inherited and mirrors its exit code (the block protocol rides exitCode 2 /
// the stdout-JSON decision).

const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { blobPath } = require('./snapshot-cache-path.cjs')

const DIR = __dirname
const event = process.argv[2]

// Resolve the blob for THIS runtime + THIS bundle source. snapshot-cache-path
// keys the directory to (node version × arch × V8 tag × uid) the way Node keys
// its compile cache; we add the bundle's content hash as the filename so a guard
// edit (new bundle → new hash) misses cleanly instead of booting stale logic.
// Hashing the bundle is sub-millisecond against the hundreds of ms a hit saves.
function currentBlobPath() {
  const src = fs.readFileSync(path.join(DIR, 'snapshot-bundle.cjs'))
  const sha = crypto.createHash('sha256').update(src).digest('hex').slice(0, 16)
  return blobPath('dispatch', sha)
}

function failOpenToIndex() {
  // The compile-cache path is correct on every platform/version.
  require('./index.cjs')
}

let blobExists
function hasBlobFile(blobFilePath) {
  if (blobExists === undefined) {
    blobExists = fs.existsSync(blobFilePath)
  }
  return blobExists
}

if (!event) {
  process.exit(0)
}

// A miss or throw anywhere here is non-fatal: the blob is a pure startup
// optimization, so any failure to find/compute it falls open to the
// always-correct compile-cache path rather than wedging the hook.
let blob
try {
  blob = currentBlobPath()
} catch {
  blob = undefined
}

if (!blob || !hasBlobFile(blob)) {
  failOpenToIndex()
} else {
  // The snapshot-booted process reads the event from argv[1] (no script path in
  // a snapshot-booted argv), so pass the event as the sole arg after the flag.
  const res = spawnSync(
    process.execPath,
    ['--snapshot-blob', blob, event],
    { stdio: 'inherit' },
  )
  if (res.error) {
    // The blob failed to load (a version/arch/V8 mismatch slipped past the key,
    // or corruption — Node refuse-to-boots either) — fall back, don't wedge.
    failOpenToIndex()
  } else {
    process.exit(res.status === null ? 0 : res.status)
  }
}
