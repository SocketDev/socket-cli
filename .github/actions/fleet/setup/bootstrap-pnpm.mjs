/**
 * @file Decision core for the fleet setup action's pnpm BOOTSTRAP path — the
 *   branch the "Install pnpm" step takes only when
 *   scripts/fleet/setup/external-tools.json is absent. A THIN member
 *   untracks the whole scripts/fleet/** payload and repopulates it from the
 *   pinned release bundle during `pnpm install` — which needs a working pnpm
 *   to run in the first place — so on a fresh thin checkout TOOLS_FILE
 *   legitimately does not exist yet, before the install that would fetch it
 *   can run.
 *   package.json's `devEngines.packageManager` is the fleet's ENFORCED
 *   package-manager pin (sync-package-manager-pins.mts derives it from
 *   external-tools.json) and, unlike external-tools.json itself, it IS
 *   always tracked, even on a thin member. Corepack and its exact
 *   `packageManager` field are retired fleet-wide (no-corepack-guard,
 *   docs/agents.md/fleet/tooling.md), so devEngines.packageManager is the
 *   ONLY bootstrap source. Its `.version` is a major-bounded SemVer RANGE
 *   (e.g. `>=11.0.0 <12.0.0`), not a concrete version, so there is no single
 *   download until it is resolved against what pnpm has actually published —
 *   the semver-range functions below do that against the npm registry's own
 *   abbreviated packument (`Accept: application/vnd.npm.install-v1+json`,
 *   the same request shape npm/Corepack themselves use). Once resolved, the
 *   per-version manifest's `dist.integrity` (already SRI-shaped) verifies
 *   the download the same way `_shared/install-tool.mjs` verifies every
 *   other pinned tool — integrity checking is not weakened, only its source
 *   moves from the missing pin file to npm's registry metadata for this
 *   bootstrap-only install. The action's normal path (TOOLS_FILE present) is
 *   unchanged and stays the CI source of truth; this pnpm only has to be
 *   good enough to run the `pnpm install` that fetches TOOLS_FILE.
 *   Pure decision functions are exported for the wheelhouse unit suite; the
 *   thin CLI shell at the bottom reads inputs from env and prints decisions
 *   to stdout — same shape as the co-located plan-setup-tools.mjs and
 *   plan-setup-node.mjs. Dependency-free on purpose: it runs on the runner's
 *   system Node before any install exists, so only `node:` builtins are
 *   used. Subcommands (inputs via env, decisions on stdout):
 *
 *   - devengines-version: DEVENGINES_NAME, DEVENGINES_VERSION_RANGE → the highest
 *     published pnpm version satisfying the range, or a non-zero exit with no
 *     stdout when the name isn't pnpm, the range doesn't parse, or nothing
 *     published satisfies it.
 *   - dist: PNPM_VERSION → two lines, the npm-registry tarball URL and its
 *     `dist.integrity`.
 */

import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * The npm registry's per-version manifest URL — `GET`ting it returns just
 * that version's `dist` block instead of every published version.
 */
export function npmVersionManifestUrl(pkgName, version) {
  return `https://registry.npmjs.org/${pkgName}/${version}`
}

/**
 * The npm registry's whole-package packument URL. Callers pair this with the
 * `application/vnd.npm.install-v1+json` Accept header (the same abbreviated
 * shape npm and Corepack themselves request) so range resolution reads a
 * `{version: {dist}}` map without pulling down full per-version metadata
 * (READMEs, dependency trees) for every release ever published.
 */
export function npmPackumentUrl(pkgName) {
  return `https://registry.npmjs.org/${pkgName}`
}

/**
 * Parse a clean `X.Y.Z` release into its numeric triple. Undefined on
 * anything else — a prerelease/build tag, a range, a tag like `latest`. The
 * fleet's package-manager pins are always clean releases (same assumption
 * sync-package-manager-pins.mts's own compareSemver makes).
 */
export function parseSemverTriple(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((version ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/**
 * Compare two semver triples: negative when `a` is older, positive when
 * newer, 0 when equal.
 */
export function compareSemverTriples(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Parse one range comparator token (`>=11.0.0`, `<12.0.0`, or a bare
 * `11.0.5` treated as an exact `=` match) into `{ op, triple }`. Undefined
 * on an unsupported operator or a non-clean-release version.
 */
export function parseSemverComparator(token) {
  const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec((token ?? '').trim())
  if (!m) {
    return undefined
  }
  const triple = parseSemverTriple(m[2])
  return triple ? { op: m[1] ?? '=', triple } : undefined
}

/**
 * Parse a whitespace-separated AND'd comparator set — the only range shape
 * the fleet ever generates (sync-package-manager-pins.mts's
 * majorBoundedRange: `>=X.0.0 <Y.0.0`). Undefined on an empty range, an OR
 * set (`||`, unsupported), or any token that doesn't parse — the caller
 * falls through to the hard-fail rather than mis-resolving.
 */
export function parseSemverRange(range) {
  const trimmed = (range ?? '').trim()
  if (!trimmed || trimmed.includes('||')) {
    return undefined
  }
  const tokens = trimmed.split(/\s+/)
  const comparators = []
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const comparator = parseSemverComparator(tokens[i])
    if (!comparator) {
      return undefined
    }
    comparators.push(comparator)
  }
  return comparators
}

/**
 * True when every comparator in the set accepts the given triple (the AND
 * semantics a space-separated range carries).
 */
export function satisfiesSemverRange(triple, comparators) {
  return comparators.every(({ op, triple: bound }) => {
    const cmp = compareSemverTriples(triple, bound)
    switch (op) {
      case '>=':
        return cmp >= 0
      case '<=':
        return cmp <= 0
      case '>':
        return cmp > 0
      case '<':
        return cmp < 0
      default:
        return cmp === 0
    }
  })
}

/**
 * The highest of `versions` (any order, `X.Y.Z` strings) satisfying `range`.
 * Undefined when the range doesn't parse or nothing in `versions` matches —
 * either way the caller falls through to the hard-fail instead of guessing.
 * This is the resolver the bootstrap uses against
 * `devEngines.packageManager.version`: there is no single download for a
 * range until it is resolved against what npm has actually published.
 */
export function resolveHighestSatisfying(range, versions) {
  const comparators = parseSemverRange(range)
  if (!comparators) {
    return undefined
  }
  let best
  let bestTriple
  for (let i = 0, { length } = versions; i < length; i += 1) {
    const triple = parseSemverTriple(versions[i])
    if (!triple || !satisfiesSemverRange(triple, comparators)) {
      continue
    }
    if (!bestTriple || compareSemverTriples(triple, bestTriple) > 0) {
      best = versions[i]
      bestTriple = triple
    }
  }
  return best
}

/**
 * Pull `{ tarball, integrity }` out of a fetched npm registry version
 * manifest. npm publishes `dist.integrity` in the same SRI shape
 * _shared/install-tool.mjs verifies — no local hex→SRI conversion needed.
 * Undefined when either field is missing (a registry-shape surprise, not a
 * network error — the caller distinguishes the two).
 */
export function extractNpmDist(manifest) {
  const tarball = manifest?.dist?.tarball
  const integrity = manifest?.dist?.integrity
  return tarball && integrity ? { integrity, tarball } : undefined
}

function env(name) {
  return process.env[name] ?? ''
}

// Each decided line is emitted `line\n`, matching plan-setup-tools.mjs's
// printLines — the step consumes single values via command substitution.
function printLines(lines) {
  process.stdout.write(lines.map(line => `${line}\n`).join(''))
}

// Fetch the npm registry's per-version manifest. Failing loud here — HTTP
// failure or a manifest missing dist.tarball/dist.integrity — matches
// plan-setup-node.mjs's fetchDistText: a thin network wrapper around
// built-in `fetch`, untested directly, whose data-shaping (extractNpmDist)
// IS unit-tested.
async function fetchNpmDist(pkgName, version) {
  const url = npmVersionManifestUrl(pkgName, version)
  // pre-install composite-action helper; @socketsecurity/lib-stable is not on
  // disk yet, only built-in fetch is available.
  // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- fetch only
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    process.stderr.write(
      `× npm registry lookup failed: HTTP ${res.status} ${res.statusText}.\n` +
        `  Where: ${url}\n` +
        '  Fix: retry the job; if the npm registry is down, wait it out.\n',
    )
    process.exit(1)
  }
  const manifest = await res.json()
  const dist = extractNpmDist(manifest)
  if (!dist) {
    process.stderr.write(
      `× npm registry manifest for ${pkgName}@${version} has no dist.tarball / dist.integrity.\n` +
        `  Where: ${url}\n` +
        `  Saw: dist=${JSON.stringify(manifest?.dist)}\n` +
        '  Fix: this is a registry-side shape change, not a consumer issue — file a bug.\n',
    )
    process.exit(1)
  }
  return dist
}

// Fetch the npm registry's abbreviated packument — `Accept:
// application/vnd.npm.install-v1+json`, the same request shape npm/Corepack
// themselves use to resolve a version range. Failing loud on HTTP failure,
// same shape as fetchNpmDist beside it: a thin network wrapper, untested
// directly, whose data-shaping (resolveHighestSatisfying) IS unit-tested.
async function fetchNpmPackument(pkgName) {
  const url = npmPackumentUrl(pkgName)
  // pre-install composite-action helper; @socketsecurity/lib-stable is not on
  // disk yet, only built-in fetch is available.
  // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- fetch only
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    redirect: 'follow',
  })
  if (!res.ok) {
    process.stderr.write(
      `× npm registry packument lookup failed: HTTP ${res.status} ${res.statusText}.\n` +
        `  Where: ${url}\n` +
        '  Fix: retry the job; if the npm registry is down, wait it out.\n',
    )
    process.exit(1)
  }
  return await res.json()
}

async function main() {
  const subcommand = process.argv[2]
  switch (subcommand) {
    case 'devengines-version': {
      const name = env('DEVENGINES_NAME')
      const range = env('DEVENGINES_VERSION_RANGE')
      if (name !== 'pnpm' || !range) {
        return 1
      }
      const packument = await fetchNpmPackument('pnpm')
      const versions = Object.keys(packument?.versions ?? {})
      const resolved = resolveHighestSatisfying(range, versions)
      if (!resolved) {
        process.stderr.write(
          `× no published pnpm version satisfies devEngines.packageManager.version "${range}".\n`,
        )
        return 1
      }
      printLines([resolved])
      return 0
    }
    case 'dist': {
      const dist = await fetchNpmDist('pnpm', env('PNPM_VERSION'))
      printLines([dist.tarball, dist.integrity])
      return 0
    }
    default: {
      process.stderr.write(
        `× bootstrap-pnpm.mjs: unknown subcommand "${subcommand ?? ''}".\n`,
      )
      return 1
    }
  }
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile, the
// same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined (mirrors the sibling plan-setup-*.mjs).
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
