'use strict'

// Snapshot-blob cache location + key. We OWN this layer because Node does not:
// Node manages the V8 COMPILE cache (NODE_COMPILE_CACHE) end to end — keying,
// validation, invalidation — but userland startup-snapshot blobs get no
// location, no cache, and no recreation from Node; it only refuse-to-boots a
// version/arch/platform-mismatched blob on load (it does NOT checksum the
// payload). So we mirror Node's OWN compile-cache path scheme for our snapshot
// store, so a node/arch/V8 change lands in a FRESH subdir rather than a
// refuse-to-boot blob sitting in the active path.
//
// Mirrors Node's GetCacheVersionTag() — nodejs/node v26.4.0,
// src/compile_cache.cc L47-L59:
//   https://github.com/nodejs/node/blob/v26.4.0/src/compile_cache.cc#L47-L59
//     tag  = NODE_VERSION "-" NODE_ARCH "-" Uint32ToHex(CachedDataVersionTag())
//     #ifdef NODE_IMPLEMENTS_POSIX_CREDENTIALS        // L55 — POSIX only
//       tag += "-" + std::to_string(getuid())         // decimal; OMITTED on Windows

const path = require('node:path')
const fs = require('node:fs')
const v8 = require('node:v8')

// 8 lowercase zero-padded hex, matching Node's Uint32ToHex() — nodejs/node
// v26.4.0, src/compile_cache.cc L28-L39:
//   https://github.com/nodejs/node/blob/v26.4.0/src/compile_cache.cc#L28-L39
// `>>> 0` because v8.cachedDataVersionTag() returns a signed JS number that can
// exceed 2^31, whereas the C++ tag is an unsigned uint32.
function v8Tag() {
  return (v8.cachedDataVersionTag() >>> 0).toString(16).padStart(8, '0')
}

// process.version already carries the leading "v" (e.g. "v26.4.0"), matching the
// NODE_VERSION macro Node concatenates. getuid is POSIX-only (absent on Windows
// and Android) — a presence check, NOT `?.() ?? 0`, so Windows OMITS the segment
// exactly like Node's #ifdef rather than appending a `-0` placeholder Node never
// writes. getuid() is decimal, matching std::to_string(getuid()).
function versionTag() {
  const uid = typeof process.getuid === 'function' ? `-${process.getuid()}` : ''
  return `${process.version}-${process.arch}-${v8Tag()}${uid}`
}

// Durable per-runtime store under the repo's `.cache/` (the fleet
// runtime-state home for dep-0 code): git-ignored by the fleet block's
// `**/.cache/` glob, out of the tracked tree, and — unlike `os.tmpdir()` —
// NOT reaped by the OS on a timer.
// tmpdir reaping silently drops the blob, and while the launcher then fail-opens
// to index.cjs (correct, ~13-16ms slower), the fast path never survived a temp
// sweep. The store survives `rm -rf node_modules` and a package `clean`, so
// the blob is regenerated only when the next hook-bundle build asks for it;
// a missing blob is never an error, launcher fail-opens, builder recreates.
// Build-time only — the
// launcher reads the frozen snapshot-blob.path sidecar, never this module.
//
// Walk to the workspace marker instead of assuming this file has a fixed depth:
// the canonical template copy lives below template/base/, while the dogfooded
// copy lives directly below the repo root. Both must share the real repo cache.
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
  return undefined
}

function snapshotCacheDir() {
  const repoRoot = findRepoRoot(__dirname)
  if (!repoRoot) {
    throw new Error('Cannot locate the fleet workspace root')
  }
  return path.join(
    repoRoot,
    '.cache',
    'fleet',
    'node-snapshot-cache',
    versionTag(),
  )
}

// Per-blob filename is content-addressed on the entry's source hash, so editing
// a guard yields a different blob and a stale source can NEVER boot old logic: a
// miss falls open to the non-snapshot path. This is the fail-open-correct half
// of "Node only validates version, not payload" — content keying is ours to own.
// A bundle edit orphans the prior blob; .cache is NOT OS-reaped, so
// pruneStaleBlobs() clears those orphans keep-active-only after each build.
function blobPath(entryId, sourceHash) {
  return path.join(snapshotCacheDir(), `${entryId}-${sourceHash}.blob`)
}

// Delete stale sibling blobs after a successful build, keeping only the one just
// built. A checkout has exactly ONE active blob at a time — the launcher reads
// the frozen snapshot-blob.path sidecar, which names a single blob — so every
// other content-hashed blob of the same entry is an orphan from a prior bundle
// edit. .cache is NOT OS-reaped, so without this the orphans grow
// unbounded (~16 MB each). Scoped strictly to keepBlobPath's own versionTag dir
// and entry prefix (never another node/arch/V8 dir, never another entry's active
// blob). Fail-open-safe: every filesystem call is wrapped so a prune failure can
// never break the build or an in-flight execv — an orphan has a different content
// hash than the active blob and is never the mmap'd blob of a running snapshot,
// so removing it cannot affect a live boot.
function pruneStaleBlobs(keepBlobPath) {
  try {
    const dir = path.dirname(keepBlobPath)
    const keepName = path.basename(keepBlobPath)
    const dashIndex = keepName.lastIndexOf('-')
    const entryPrefix =
      dashIndex === -1 ? keepName : keepName.slice(0, dashIndex + 1)
    const names = fs.readdirSync(dir)
    for (let i = 0, { length } = names; i < length; i += 1) {
      const name = names[i]
      if (
        name !== keepName &&
        name.endsWith('.blob') &&
        name.startsWith(entryPrefix)
      ) {
        try {
          // oxlint-disable-next-line socket/prefer-safe-delete -- dep-0 hook-dispatch .cjs: cannot import lib safeDelete; unlink is fail-open-wrapped, prune of an orphan blob
          fs.unlinkSync(path.join(dir, name))
        } catch {
          // Fail-open: an undeletable orphan is harmless — the launcher only
          // ever loads keepBlobPath.
        }
      }
    }
  } catch {
    // Fail-open: a missing/unreadable cache dir means there is nothing to prune.
  }
}

module.exports = {
  v8Tag,
  versionTag,
  findRepoRoot,
  snapshotCacheDir,
  blobPath,
  pruneStaleBlobs,
}
