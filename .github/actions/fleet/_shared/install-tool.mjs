/**
 * @file Downloads, integrity-verifies, and extracts a release asset. Replaces
 *   the curl + sha256sum/shasum + tar/unzip dance repeated across
 *   pnpm/sfw/zizmor install steps. Built-in `fetch` follows redirects
 *   automatically (github.com → objects.githubusercontent.com),
 *   `node:crypto.createHash` computes the digest in-process, and tar/unzip
 *   shell out, already preinstalled on every supported runner image. Usage:
 *   node install-tool.mjs <url> <integrity> <dest-dir> [<bin-name>] <integrity>
 *   is a Subresource Integrity string: `<algo>-<base64>` OR `<algo>-<hex>`
 *   (publisher checksum form, e.g. `sha256-<64 hex>` from go.dev / rustup /
 *   Google's Packages index). Examples: `sha256-67PM...=`,
 *   `sha256-544932...c0749c`. The algorithm is parsed from the prefix; multiple
 *   algos are supported (sha256, sha384, sha512). Same encoding as npm
 *   package-lock.json's `integrity` field and as `external-tools.json`'s
 *   `integrity` field. Backward compat: a bare 64-char hex string is also
 *   accepted and treated as `sha256-<base64-of-hex>` for transition.
 *   Deprecated; new call sites should pass SRI directly. Behavior:
 *
 *   - Streams the asset to <dest-dir>/<basename(url)>.
 *   - Aborts and removes the file if integrity mismatches.
 *   - Extracts .tar.gz/.tgz with tar, .zip with unzip (POSIX) or Expand-Archive
 *     (Windows). Removes the archive after extracting.
 *   - For non-archive assets, bare binaries like sfw: the asset IS the binary —
 *     chmod +x it and rename to <bin-name> if provided. Exit codes: 0 success 1
 *     download or extraction failed 2 integrity mismatch (stderr names expected
 *     vs actual + the path). Optional `--src <url>` + `--date <iso>` carry the
 *     object-form integrity provenance so a LIVE src check (fetch the
 *     publisher's current checksum, compare to the pin) + a `date` staleness
 *     check run AFTER the static SRI check and BEFORE extract/execute (exit 2
 *     on mismatch / strict staleness). Env: SFW_INTEGRITY_MAX_AGE_DAYS sets the
 *     threshold (default 90); SFW_INTEGRITY_STRICT=1 fails on stale instead of
 *     warning. Testability: the pure `parseIntegrity` helper is EXPORTED and
 *     the side-effectful CLI pipeline is guarded by isMainModule(), so unit
 *     tests can import this file without triggering a download. Every
 *     composite-action _shared helper follows this pattern (see
 *     check-fleet-shared-scripts-are-testable).
 */

// composite-action helper runs on the raw runner before setup-node;
// node_modules is unavailable and the download / extract pipeline is naturally
// sync.
// oxlint-disable-next-line socket/prefer-async-spawn -- sync download
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { verifyIntegrityProvenance } from './verify-integrity-provenance.mjs'

// Composite-action helper runs on the raw runner BEFORE setup-node finishes
// resolving node_modules — `@socketsecurity/lib-stable` is not on disk yet
// (the comments in the oxlint-disable directives below already document this
// constraint). Fall back to a tiny inline logger that mirrors the bits of
// @socketsecurity/lib-stable/logger that this script uses (just `.fail` for
// the usage line). Switching back to the lib logger would require pre-
// installing it, which defeats the whole point of this being a bootstrap
// step.
const logger = {
  // pre-setup-node action; @socketsecurity/lib-stable not installed yet.
  // oxlint-disable-next-line socket/no-console-prefer-logger -- no lib yet
  fail: msg => console.error(msg),
}

// Parse SRI string `<algo>-<base64>` or `<algo>-<hex>`. Bare 64-char hex is
// treated as sha256 for backward compat — deprecated, will be removed once all
// call sites pass SRI directly. The part after the `<algo>-` prefix may be
// base64 (npm/SRI form, e.g. `sha512-…==`) OR hex (publisher checksum form,
// e.g. `sha256-<64 hex chars>` from go.dev / rustup / Google's Packages
// index). A hex-length all-hex remainder is converted to base64 so the
// comparison stays in one shape. Throws on an unrecognized format (NOT
// process.exit) so the parser is unit-testable; the CLI run() wrapper lets it
// propagate to its .catch, which logs + exits 1.
// every non-returning arm ends in process.exit(1); the analyzer cannot see the
// never.
// oxlint-disable-next-line socket/export-top-level-functions, typescript/consistent-return -- action helper
export function parseIntegrity(s) {
  // Parse an SRI string: (1) the algorithm (sha256/384/512), (2) the digest
  // after the dash — base64 (npm/SRI) or hex (publisher checksum).
  const m = /^(sha(?:256|384|512))-(.+)$/.exec(s)
  if (m) {
    const algo = m[1]
    const rest = m[2]
    const hexLen = algo === 'sha256' ? 64 : algo === 'sha384' ? 96 : 128
    if (rest.length === hexLen && /^[0-9a-f]+$/i.test(rest)) {
      // `<algo>-<hex>` form (go.dev / rustup / Google .deb checksums) —
      // convert to base64 so the comparison is shape-consistent.
      return { algo, expected: Buffer.from(rest, 'hex').toString('base64') }
    }
    return { algo, expected: rest }
  }
  if (/^[0-9a-f]{64}$/i.test(s)) {
    // Bare sha256 hex — convert to SRI base64 for the comparison.
    return {
      algo: 'sha256',
      expected: Buffer.from(s, 'hex').toString('base64'),
    }
  }
  throw new Error(
    `unrecognized integrity format: ${s}\n  Expected SRI (e.g. sha256-base64=) or sha256-<hex>`,
  )
}

// true when this file is the invoked script (not imported). Lets the pure
// helpers above be imported by unit tests without triggering the download /
// verify / extract pipeline.
function isMainModule() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    // realpath both sides before comparing. Node normalizes `..` in argv[1]
    // but leaves symlinks in place, while import.meta.url is fully resolved, so
    // a launch path under a symlinked prefix (macOS /tmp and /var/folders, a
    // symlinked checkout) compares unequal and the CLI silently does nothing
    // while exiting 0.
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

// CLI entry point. Guarded by isMainModule() so importing this file (for the
// exported parseIntegrity helper) does NOT run the download/verify/extract
// pipeline.
async function run() {
  // Positionals: <url> <integrity> <dest-dir> [<bin-name>]. Optional flags
  // --src <url> and --date <iso> carry the object-form integrity provenance
  // (forwarded by the composite actions from resolve-external-tool-asset.mjs's
  // JSON output) so the live src / staleness checks run after the SRI check.
  const flags = { src: '', date: '' }
  const positionals = []
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--date' || a === '--src') {
      flags[a.slice(2)] = process.argv[++i] ?? ''
    } else {
      positionals.push(a)
    }
  }
  const [url, integrityArg, destDir, binName] = positionals

  if (!url || !integrityArg || !destDir) {
    logger.fail(
      'usage: install-tool.mjs <url> <integrity> <dest-dir> [<bin-name>] [--src <url>] [--date <iso>]',
    )
    process.exit(1)
  }

  const { algo, expected } = parseIntegrity(integrityArg)

  mkdirSync(destDir, { recursive: true })

  const assetName = path.basename(new URL(url).pathname)
  const archivePath = path.join(destDir, assetName)

  const headers = { __proto__: null }
  // GitHub release assets in private repos require auth. When
  // GITHUB_TOKEN is in env, every Actions run sets it, forward it as
  // a bearer header so the same call site works for both public and
  // private release-asset URLs.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  // Composite-action helper runs as a standalone node script on the raw runner;
  // the CJS bundle target rejects top-level await, so the download / verify /
  // extract pipeline runs inside an async main().
  // every non-returning arm ends in process.exit(1); the analyzer cannot see
  // the never.
  // oxlint-disable-next-line socket/export-top-level-functions, typescript/consistent-return -- action helper
  async function main() {
    // pre-setup-node action; @socketsecurity/lib-stable not installed yet, only
    // built-in fetch is available.
    // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- fetch only
    const res = await fetch(url, { redirect: 'follow', headers })
    if (!res.ok) {
      // oxlint-disable-next-line socket/no-logger-glyph-prefix -- bootstrap shim; logger.fail does not print a glyph
      logger.fail(
        `× download failed: HTTP ${res.status} ${res.statusText} for ${url}`,
      )
      process.exit(1)
    }

    const bytes = new Uint8Array(await res.arrayBuffer())
    const actual = crypto.createHash(algo).update(bytes).digest('base64')

    // Compare base64 forms directly. Trailing `=` padding may differ
    // npm strips it, our hash adds it — strip both sides before
    // comparing so `sha512-...=` and `sha512-...` match.
    const stripPadding = b64 => b64.replace(/=+$/, '')
    if (stripPadding(actual) !== stripPadding(expected)) {
      // oxlint-disable-next-line socket/no-logger-glyph-prefix -- bootstrap shim; logger.fail does not print a glyph
      logger.fail(`× ${algo} integrity mismatch for ${assetName}`)
      logger.fail(`  Expected: ${algo}-${expected}`)
      logger.fail(`  Actual:   ${algo}-${actual}`)
      logger.fail(`  URL:      ${url}`)
      process.exit(2)
    }

    // ── live provenance + staleness check ────────────────────────────────
    // The static SRI check above verified the DOWNLOADED bytes against
    // `value`. When --src/--date are forwarded (object-form integrity), now
    // verify `value` is still the publisher's current checksum and that the
    // pin is not stale. Runs BEFORE extract/execute so a stale / re-released
    // / compromised pin aborts loudly (exit 2) before the asset touches disk
    // for extraction. String-form integrity (no flags) is a no-op here.
    if (flags.src || flags.date) {
      const maxAgeEnv = Number(process.env.SFW_INTEGRITY_MAX_AGE_DAYS)
      const provenance = await verifyIntegrityProvenance(
        { value: integrityArg, src: flags.src, date: flags.date },
        {
          assetFilename: assetName,
          maxAgeDays:
            Number.isFinite(maxAgeEnv) && maxAgeEnv > 0 ? maxAgeEnv : 90,
          strict: process.env.SFW_INTEGRITY_STRICT === '1',
        },
      )
      if (!provenance.ok) {
        // oxlint-disable-next-line socket/no-logger-glyph-prefix -- bootstrap shim
        logger.fail(`× integrity provenance check failed for ${assetName}`)
        logger.fail(`  ${provenance.reason}`)
        process.exit(2)
      }
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
        // oxlint-disable-next-line socket/no-logger-glyph-prefix -- bootstrap shim; logger.fail does not print a glyph
        logger.fail(`× extraction failed: ${extractCmd} exited ${r.status}`)
        process.exit(1)
      }
      // dep-0: pre-setup-node composite-action helper; @socketsecurity/lib-stable
      // is not on disk yet, so safeDelete is unavailable.
      // oxlint-disable-next-line socket/prefer-safe-delete -- dep-0
      rmSync(archivePath, { force: true })
    } else if (binName) {
      // Bare-binary asset, no archive. Rename to bin-name and chmod.
      const finalPath = path.join(destDir, binName)
      renameSync(archivePath, finalPath)
      chmodSync(finalPath, 0o755)
    } else {
      chmodSync(archivePath, 0o755)
    }
  }

  void main().catch(e => {
    logger.fail(e)
    process.exit(1)
  })
}

if (isMainModule()) {
  void run()
}
