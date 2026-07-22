/**
 * @file Downloads, integrity-verifies, and extracts a release asset. Replaces
 *   the curl + sha256sum/shasum + tar/unzip dance repeated across
 *   pnpm/sfw/zizmor install steps. Built-in `fetch` follows redirects
 *   automatically (github.com → objects.githubusercontent.com),
 *   `node:crypto.createHash` computes the digest in-process, and tar/unzip
 *   shell out (already preinstalled on every supported runner image). Usage:
 *   node install-tool.mjs <url> <integrity> <dest-dir> [<bin-name>] <integrity>
 *   is a Subresource Integrity string: `<algo>-<base64>`. Examples:
 *   `sha256-67PM...=`, `sha512-l/kG...==`. The algorithm is parsed from the
 *   prefix; multiple algos are supported (sha256, sha384, sha512). Same
 *   encoding as npm package-lock.json's `integrity` field and as
 *   `external-tools.json`'s `integrity` field. Backward compat: a bare 64-char
 *   hex string is also accepted and treated as `sha256-<base64-of-hex>` for
 *   transition. Deprecated; new call sites should pass SRI directly. Behavior:
 *
 *   - Streams the asset to <dest-dir>/<basename(url)>.
 *   - Aborts and removes the file if integrity mismatches.
 *   - Extracts .tar.gz/.tgz with tar, .zip with unzip (POSIX) or Expand-Archive
 *     (Windows). Removes the archive after extracting.
 *   - For non-archive assets (bare binaries like sfw): the asset IS the binary —
 *     chmod +x it and rename to <bin-name> if provided. Exit codes: 0 success 1
 *     download or extraction failed 2 integrity mismatch (stderr names expected
 *     vs actual + the path)
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- composite-action helper runs on the raw runner before setup-node; node_modules is unavailable and the download / extract pipeline is naturally sync.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// Composite-action helper runs on the raw runner BEFORE setup-node finishes
// resolving node_modules — `@socketsecurity/lib-stable` is not on disk yet
// (the comments in the oxlint-disable directives below already document this
// constraint). Fall back to a tiny inline logger that mirrors the bits of
// @socketsecurity/lib-stable/logger that this script uses (just `.fail` for
// the usage line). Switching back to the lib logger would require pre-
// installing it, which defeats the whole point of this being a bootstrap
// step.
const logger = {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
  fail: msg => console.error(msg),
}

const [, , url, integrityArg, destDir, binName] = process.argv

if (!url || !integrityArg || !destDir) {
  logger.fail(
    '× usage: install-tool.mjs <url> <integrity> <dest-dir> [<bin-name>]',
  )
  process.exit(1)
}

// Parse SRI string `<algo>-<base64>`. Bare 64-char hex is treated as
// sha256 for backward compat — deprecated, will be removed once all
// call sites pass SRI directly.
// oxlint-disable-next-line socket/export-top-level-functions -- composite-action helper runs on the raw runner before setup-node; no node_modules, no module boundary worth exporting across.
function parseIntegrity(s) {
  // Parse an SRI string: (1) the algorithm (sha256/384/512), (2) the base64
  // digest after the dash.
  const m = /^(sha(?:256|384|512))-(.+)$/.exec(s)
  if (m) {
    return { algo: m[1], expected: m[2] }
  }
  if (/^[0-9a-f]{64}$/i.test(s)) {
    // Bare sha256 hex — convert to SRI base64 for the comparison.
    return {
      algo: 'sha256',
      expected: Buffer.from(s, 'hex').toString('base64'),
    }
  }
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
  console.error(
    `× unrecognized integrity format: ${s}\n  Expected SRI (e.g. sha256-base64=)`,
  )
  process.exit(1)
}

const { algo, expected } = parseIntegrity(integrityArg)

mkdirSync(destDir, { recursive: true })

const assetName = path.basename(new URL(url).pathname)
const archivePath = path.join(destDir, assetName)

const headers = { __proto__: null }
// GitHub release assets in private repos require auth. When
// GITHUB_TOKEN is in env (every Actions run sets it), forward it as
// a bearer header so the same call site works for both public and
// private release-asset URLs.
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
}

// Composite-action helper runs as a standalone node script on the raw runner;
// the CJS bundle target rejects top-level await, so the download / verify /
// extract pipeline runs inside an async IIFE.
// oxlint-disable-next-line socket/export-top-level-functions -- composite-action helper runs on the raw runner before setup-node; no node_modules, no module boundary worth exporting across.
async function main() {
  // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- pre-setup-node action; @socketsecurity/lib-stable not installed yet, only built-in fetch is available.
  const res = await fetch(url, { redirect: 'follow', headers })
  if (!res.ok) {
    // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
    console.error(
      `× download failed: HTTP ${res.status} ${res.statusText} for ${url}`,
    )
    process.exit(1)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  const actual = crypto.createHash(algo).update(bytes).digest('base64')

  // Compare base64 forms directly. Trailing `=` padding may differ
  // (npm strips it, our hash adds it) — strip both sides before
  // comparing so `sha512-...=` and `sha512-...` match.
  const stripPadding = b64 => b64.replace(/=+$/, '')
  if (stripPadding(actual) !== stripPadding(expected)) {
    // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
    console.error(`× ${algo} integrity mismatch for ${assetName}`)
    // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; same.
    console.error(`  Expected: ${algo}-${expected}`)
    // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; same.
    console.error(`  Actual:   ${algo}-${actual}`)
    // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; same.
    console.error(`  URL:      ${url}`)
    process.exit(2)
  }

  writeFileSync(archivePath, bytes)

  const lower = assetName.toLowerCase()
  let extractCmd
  let extractArgs
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    extractCmd = 'tar'
    // Run inside the destination and pass a local basename. Git for Windows'
    // tar treats an absolute `D:\\...` archive path as `host:path` and tries
    // to connect to a host named D; the basename is portable across GNU tar,
    // bsdtar, and the tar bundled with Git for Windows.
    extractArgs = ['xzf', assetName]
  } else if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      extractCmd = 'powershell'
      extractArgs = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ]
    } else {
      extractCmd = 'unzip'
      extractArgs = ['-qo', archivePath, '-d', destDir]
    }
  }

  if (extractCmd) {
    const r = spawnSync(extractCmd, extractArgs, {
      cwd: destDir,
      stdio: 'inherit',
    })
    if (r.status !== 0) {
      // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
      console.error(`× extraction failed: ${extractCmd} exited ${r.status}`)
      process.exit(1)
    }
    // oxlint-disable-next-line socket/prefer-safe-delete -- dep-0: pre-setup-node composite-action helper; @socketsecurity/lib-stable is not on disk yet, so safeDelete is unavailable.
    rmSync(archivePath, { force: true })
  } else if (binName) {
    // Bare-binary asset (no archive). Rename to bin-name and chmod.
    const finalPath = path.join(destDir, binName)
    renameSync(archivePath, finalPath)
    chmodSync(finalPath, 0o755)
  } else {
    chmodSync(archivePath, 0o755)
  }
}

main().catch(e => {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
  console.error(e)
  process.exit(1)
})
