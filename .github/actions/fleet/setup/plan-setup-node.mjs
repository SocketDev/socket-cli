/**
 * @file Decision core for the fleet setup action's "Install Node.js" step —
 *   the native port of `actions/setup-node` (reference pin
 *   `upstream/actions-setup-node`, reviewed at v7.0.0). The step follows the
 *   same pinned-tool pattern as the pnpm and sfw installs beside it: resolve
 *   a pinned version, download the platform asset, verify it against a
 *   digest, extract, and prepend the bin dir to $GITHUB_PATH. Node's digests
 *   come from the release's own SHASUMS256.txt on nodejs.org rather than
 *   external-tools.json — every Node release publishes one — so this plan
 *   converts the asset's hex line into the SRI string the sibling
 *   _shared/install-tool.mjs verifies. Deliberately NOT ported from upstream:
 *   the registry-url/.npmrc surface. Upstream writes
 *   `//<registry>/:_authToken=${NODE_AUTH_TOKEN}` into the runner .npmrc and
 *   leaves a placeholder NODE_AUTH_TOKEN in every later step's env; fleet npm
 *   publishes authenticate via OIDC trusted publishing and the preflight
 *   refuses any set token (scripts/fleet/registry-infra/npm/auth-posture.mts),
 *   so the port removes that credential surface instead of reproducing it.
 *   Pure decision functions are exported for the wheelhouse unit suite; the
 *   thin CLI shell at the bottom reads inputs from env and prints decisions
 *   to stdout — same shape as the co-located plan-setup-tools.mjs.
 *   Dependency-free on purpose: it runs on the runner's system Node before
 *   any install exists, so only `node:` builtins are used. Subcommands
 *   (inputs via env, decisions on stdout):
 *
 *   - resolve-version: NODE_WANTED → the exact version, no leading `v`. An exact
 *     X.Y.Z passes through with no network read; a bare X / X.Y / X.x prefix
 *     resolves to the newest match in the nodejs.org release index.
 *   - dist-asset: NODE_VERSION, PLATFORM → two lines: the nodejs.org asset name,
 *     then the extracted bin dir relative to the extraction root.
 *   - shasums-sri: NODE_VERSION, ASSET → the asset's `sha256-<base64>` SRI
 *     string, converted from the release's SHASUMS256.txt hex line.
 */

import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const NODE_DIST_BASE_URL = 'https://nodejs.org/dist'

// The nodejs.org platform tokens the canonical Socket platform strings
// (_shared/platform.mjs output) map onto 1:1. nodejs.org publishes no musl
// build, so the `-musl` platforms are deliberately absent — the CLI fails
// loud on them instead of shipping a glibc binary that dies at runtime.
const NODE_DIST_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win-arm64',
  'win-x64',
])

/**
 * Parse a node-version input into a version spec. Accepted shapes, with or
 * without a leading `v`: exact `X.Y.Z`; prefix `X`, `X.Y`, `X.x`, or `X.Y.x`
 * (resolved against the release index). Anything else — `lts/*`, ranges,
 * `latest`, prerelease tags — is unsupported: the fleet pins tools exactly,
 * so the aliases upstream setup-node resolves are a moving-target surface
 * this port refuses.
 */
export function parseNodeVersionSpec(wanted) {
  const spec = wanted.trim().replace(/^v/, '')
  // Version-spec grammar: (1) the major digits, then up to two optional
  // dot-separated segments, (2) the minor and (3) the patch, each either
  // digits or the literal `x` placeholder.
  const m = /^(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?$/.exec(spec)
  if (!m) {
    return { kind: 'unsupported' }
  }
  const [, major, minor, patch] = m
  const minorIsNumber = minor !== undefined && minor !== 'x'
  const patchIsNumber = patch !== undefined && patch !== 'x'
  if (!minorIsNumber && patchIsNumber) {
    // `X.x.5` — a number below an x placeholder names nothing.
    return { kind: 'unsupported' }
  }
  if (minorIsNumber && patchIsNumber) {
    return { kind: 'exact', version: `${major}.${minor}.${patch}` }
  }
  if (minorIsNumber) {
    // `X.Y` or `X.Y.x` — resolve the newest patch of that minor.
    return { kind: 'prefix', prefix: `v${major}.${minor}.` }
  }
  // `X`, `X.x`, or `X.x.x` — resolve the newest release of that major.
  return { kind: 'prefix', prefix: `v${major}.` }
}

// Numeric [major, minor, patch] of a `vX.Y.Z` index entry, for the
// newest-match compare. Non-release entries (nightlies, rc tags) never reach
// this: the prefix filter only matches `v<digits>.` shapes.
function versionTriple(version) {
  return version
    .replace(/^v/, '')
    .split('.')
    .map(part => Number.parseInt(part, 10))
}

// Positive when a is newer than b, negative when older, 0 when equal.
function compareTriples(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Resolve a node-version input against the release index's version strings
 * (`v26.5.0` shapes, any order). An exact spec passes through untouched — no
 * index read backs it, the SHASUMS256.txt fetch is what discovers a version
 * that does not exist. A prefix spec picks the numerically-newest match; the
 * index is documented newest-first but the compare never relies on that.
 * Undefined when the spec is unsupported or nothing matches.
 */
export function resolveNodeVersionFrom(wanted, indexVersions) {
  const spec = parseNodeVersionSpec(wanted)
  if (spec.kind === 'exact') {
    return spec.version
  }
  if (spec.kind === 'unsupported') {
    return undefined
  }
  let best
  let bestTriple
  for (let i = 0, { length } = indexVersions; i < length; i += 1) {
    const version = indexVersions[i]
    if (!version.startsWith(spec.prefix)) {
      continue
    }
    const triple = versionTriple(version)
    if (triple.length !== 3 || triple.some(Number.isNaN)) {
      continue
    }
    if (!bestTriple || compareTriples(triple, bestTriple) > 0) {
      best = version.replace(/^v/, '')
      bestTriple = triple
    }
  }
  return best
}

/**
 * The nodejs.org dist asset for a resolved version + canonical Socket
 * platform string, plus the bin dir the archive extracts to (relative to the
 * extraction root). POSIX tarballs carry `node`/`npm`/`npx` under
 * `<root>/bin`; Windows zips carry `node.exe` and the npm shims at the
 * archive root. Undefined for a platform nodejs.org does not publish — the
 * musl variants and anything unrecognized.
 */
export function nodeDistAsset(version, platform) {
  if (!NODE_DIST_PLATFORMS.has(platform)) {
    return undefined
  }
  const root = `node-v${version}-${platform}`
  return platform.startsWith('win-')
    ? { asset: `${root}.zip`, binRelDir: root }
    : { asset: `${root}.tar.gz`, binRelDir: `${root}/bin` }
}

/**
 * The `sha256-<base64>` SRI string for one asset out of a release's
 * SHASUMS256.txt text (`<64-hex>  <filename>` lines), in the encoding the
 * sibling _shared/install-tool.mjs verifies. Undefined when the asset has no
 * line — the caller fails loud with the URL it read.
 */
export function sriFromShasums(shasumsText, asset) {
  const lines = shasumsText.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // Digest-line grammar: (1) the 64-hex sha256, whitespace, then (2) the
    // asset filename, with trailing whitespace tolerated.
    const m = /^([0-9a-f]{64})\s+(\S+)\s*$/.exec(lines[i])
    if (m && m[2] === asset) {
      return `sha256-${Buffer.from(m[1], 'hex').toString('base64')}`
    }
  }
  return undefined
}

// Fetch a nodejs.org dist resource as text, failing loud with the URL — the
// two callers (release index, SHASUMS256.txt) share the error shape.
async function fetchDistText(url) {
  // pre-install composite-action helper; @socketsecurity/lib-stable is not on
  // disk yet, only built-in fetch is available.
  // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- fetch only
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    process.stderr.write(
      `× nodejs.org download failed: HTTP ${res.status} ${res.statusText}.\n` +
        `  Where: ${url}\n` +
        '  Fix: retry the job; if nodejs.org is down, wait it out — the fleet pins Node from nodejs.org/dist only.\n',
    )
    process.exit(1)
  }
  return await res.text()
}

function env(name) {
  return process.env[name] ?? ''
}

// Each decided line is emitted `line\n` — the step consumes single values via
// command substitution and multi-line plans via `read -r` blocks.
function printLines(lines) {
  process.stdout.write(lines.map(line => `${line}\n`).join(''))
}

async function main() {
  const subcommand = process.argv[2]
  switch (subcommand) {
    case 'resolve-version': {
      const wanted = env('NODE_WANTED')
      const spec = parseNodeVersionSpec(wanted)
      if (spec.kind === 'unsupported') {
        process.stderr.write(
          `× unsupported node-version spec "${wanted}".\n` +
            "  Where: the fleet setup action's node-version input.\n" +
            `  Saw: "${wanted}"; wanted exact X.Y.Z, or a bare X / X.Y / X.x prefix.\n` +
            '  Fix: pin an exact version (e.g. 26.5.0) — aliases like lts/* are deliberately unsupported; the fleet pins tools exactly.\n',
        )
        return 1
      }
      if (spec.kind === 'exact') {
        printLines([spec.version])
        return 0
      }
      const indexUrl = `${NODE_DIST_BASE_URL}/index.json`
      const entries = JSON.parse(await fetchDistText(indexUrl))
      const resolved = resolveNodeVersionFrom(
        wanted,
        entries.map(entry => entry.version),
      )
      if (!resolved) {
        process.stderr.write(
          `× no Node.js release matches "${wanted}".\n` +
            `  Where: ${indexUrl}\n` +
            `  Saw: ${entries.length} releases, none under the "${spec.prefix}" prefix.\n` +
            '  Fix: pass a released major (see https://nodejs.org/dist/) or an exact X.Y.Z.\n',
        )
        return 1
      }
      printLines([resolved])
      return 0
    }
    case 'dist-asset': {
      const version = env('NODE_VERSION')
      const platform = env('PLATFORM')
      const dist = nodeDistAsset(version, platform)
      if (!dist) {
        process.stderr.write(
          `× nodejs.org publishes no ${platform} Node.js build.\n` +
            "  Where: the fleet setup action's Install Node.js step (plan-setup-node.mjs dist-asset).\n" +
            `  Saw: platform "${platform}"; wanted one of ${[...NODE_DIST_PLATFORMS].join(', ')}.\n` +
            '  Fix: run the job on a glibc runner, or use a node:<version>-alpine container image that ships its own Node.\n',
        )
        return 1
      }
      printLines([dist.asset, dist.binRelDir])
      return 0
    }
    case 'shasums-sri': {
      const version = env('NODE_VERSION')
      const asset = env('ASSET')
      const shasumsUrl = `${NODE_DIST_BASE_URL}/v${version}/SHASUMS256.txt`
      const sri = sriFromShasums(await fetchDistText(shasumsUrl), asset)
      if (!sri) {
        process.stderr.write(
          `× SHASUMS256.txt has no entry for ${asset}.\n` +
            `  Where: ${shasumsUrl}\n` +
            `  Saw: no "<sha256-hex>  ${asset}" line; wanted exactly one.\n` +
            `  Fix: the version/platform pair may not exist upstream — check ${NODE_DIST_BASE_URL}/v${version}/.\n`,
        )
        return 1
      }
      printLines([sri])
      return 0
    }
    default: {
      process.stderr.write(
        `× plan-setup-node.mjs: unknown subcommand "${subcommand ?? ''}".\n`,
      )
      return 1
    }
  }
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile, the
// same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined.
function isEntrypoint(invokedPath) {
  if (!invokedPath) {
    return false
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) {
  main().then(
    code => {
      process.exitCode = code
    },
    e => {
      process.stderr.write(`${e?.stack ?? e}\n`)
      process.exitCode = 1
    },
  )
}
