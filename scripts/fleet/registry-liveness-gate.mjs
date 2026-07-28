/**
 * @file Registry-liveness gate for the fleet github-release.yml workflow.
 *   ORDER RULE: the tag + immutable GH release are the FINAL markers of a
 *   release — they may only exist AFTER the registry publish is live. A STAGED
 *   npm package is not published, staging may never be approved, so the
 *   workflow refuses to cut when the tagged version is not resolvable on its
 *   registry. Registry-less repos skip the gate.
 *   Branch shape, unchanged from the inline `run:` block this was extracted
 *   from — the v1.0.13 bundle shipped a regressed single-crate-only gate
 *   precisely because this logic lived untestable inside workflow YAML:
 *
 *   - public package.json → the npm packument must resolve for the version.
 *   - Cargo.toml → every publishable crate name must be in the crates.io sparse
 *     index at the version. Single crate: the root [package] name. Workspace:
 *     every member's name, `publish = false` members skipped, `members = [...]`
 *     globs expanded. Empty output + exit 0 = nothing publishable, a stub-only
 *     workspace; a malformed manifest fails LOUD instead of dying silently
 *     under the step's `set -e`.
 *   - neither → skip, a github-release-only repo. Dependency-free on purpose:
 *     github-release.yml runs it on the runner's system Node BEFORE any install
 *     exists, so only `node:` builtins are used — same constraint as
 *     scripts/fleet/setup/setup-tools.mjs. Node fetch stands in for the old
 *     `curl -fsS`: same URLs, same pass/fail mapping. Pure decision functions
 *     are exported for the wheelhouse unit suite; the thin CLI shell at the
 *     bottom reads TAG from the env and exits non-zero when the gate refuses.
 *     Usage: TAG=v1.2.3 node scripts/fleet/registry-liveness-gate.mjs
 */

import crypto from 'node:crypto'
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// The repo the gate inspects: two levels up from this script's own home at
// scripts/fleet/, stable however the caller's cwd wanders.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const defaultFsLike = { existsSync, globSync, readFileSync }

/**
 * The version a release tag names — a single leading `v` stripped, the
 * `${TAG#v}` the inline gate used.
 */
export function versionFromTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

/**
 * Every crate name the gate must find live on crates.io for the repo at
 * `rootDir`. Single crate: the root [package] name. Workspace: every
 * publishable member's name — `publish = false` members skipped, glob members
 * expanded, memberless dirs ignored. Throws with a Fix-bearing message when
 * the root manifest has neither a [package] name nor a members list, so the
 * gate fails loud instead of silently.
 */
export function deriveCrateNames(rootDir, fsLike = defaultFsLike) {
  const root = fsLike.readFileSync(path.join(rootDir, 'Cargo.toml'), 'utf8')
  const pkgName = /^\[package\][^]*?^name *= *"([^"]+)"/m.exec(root)
  if (pkgName) {
    return [pkgName[1]]
  }
  const members = /^members *= *\[([^\]]*)\]/m.exec(root)
  if (!members) {
    throw new Error(
      '× Cargo.toml has neither a [package] name nor a [workspace] members list — cannot derive crate names for the registry-liveness gate.\n' +
        '  Fix: give the root manifest a [package] section or a members = [...] list.',
    )
  }
  const entries = [...members[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
  const dirs = entries.flatMap(e =>
    e.includes('*') ? fsLike.globSync(e, { cwd: rootDir }) : [e],
  )
  const names = []
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const manifestPath = path.join(rootDir, dirs[i], 'Cargo.toml')
    if (!fsLike.existsSync(manifestPath)) {
      continue
    }
    const manifest = fsLike.readFileSync(manifestPath, 'utf8')
    if (/^publish *= *false/m.test(manifest)) {
      continue
    }
    const name = /^name *= *"([^"]+)"/m.exec(manifest)
    if (name) {
      names.push(name[1])
    }
  }
  return names
}

/**
 * Which registry the repo at `rootDir` must be live on. Public package.json
 * wins; a private package.json falls through to Cargo.toml, matching the
 * inline gate's if/elif; neither manifest means no gate. May throw — a
 * malformed manifest is a loud failure, never a silent skip.
 */
export function planGate(rootDir, fsLike = defaultFsLike) {
  const pkgPath = path.join(rootDir, 'package.json')
  if (fsLike.existsSync(pkgPath)) {
    const manifest = JSON.parse(fsLike.readFileSync(pkgPath, 'utf8'))
    if (manifest.private !== true) {
      return { name: String(manifest.name), registry: 'npm' }
    }
  }
  if (fsLike.existsSync(path.join(rootDir, 'Cargo.toml'))) {
    return { names: deriveCrateNames(rootDir, fsLike), registry: 'crates' }
  }
  return { registry: 'none' }
}

/**
 * The crates.io sparse-index path for a crate name — the registry's
 * length-sharded layout: `1/a`, `2/ab`, `3/a/abc`, `ab/cd/abcdef`.
 */
export function crateIndexPath(name) {
  switch (name.length) {
    case 1:
      return `1/${name}`
    case 2:
      return `2/${name}`
    case 3:
      return `3/${name[0]}/${name}`
    default:
      return `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`
  }
}

/**
 * True when a sparse-index body records the version — the extracted
 * `grep -q "\"vers\":\"${VERSION}\""`.
 */
export function indexHasVersion(indexBody, version) {
  return indexBody.includes(`"vers":"${version}"`)
}

async function fetchOk(url, fetchImpl, logError, init) {
  try {
    return await fetchImpl(url, init)
  } catch (error) {
    // The old `curl -fsS` printed its transport error and failed the gate;
    // map a thrown fetch the same way.
    logError(`× ${url} — ${error}`)
    return undefined
  }
}

// No-cache request headers for a release-liveness read.
// WHY: the npm registry CDN caches version reads for MINUTES; a liveness gate
// that trusts a cached read can see a version that is already LIVE as absent (a
// stale 404) and refuse to cut the release. The headers defeat any intermediary
// proxy; `cacheBustedNpmUrl` defeats the CDN cache key.
export const NO_CACHE_HEADERS = {
  'cache-control': 'no-cache',
  pragma: 'no-cache',
}

/**
 * A liveness URL with a unique `_cb` nonce appended so a stale CDN copy can
 * never answer. `nonce` is injectable so a test can assert the exact busting.
 */
export function cacheBustedNpmUrl(url, nonce = crypto.randomUUID()) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_cb=${nonce}`
}

/**
 * True when `name@version` resolves on the npm registry. The read is cache-
 * busted (unique nonce + no-cache headers) so a stale CDN packument cannot
 * report a live version as absent.
 */
export async function checkNpmLive(
  name,
  version,
  fetchImpl = fetch,
  logError = console.error,
) {
  const res = await fetchOk(
    cacheBustedNpmUrl(`https://registry.npmjs.org/${name}/${version}`),
    fetchImpl,
    logError,
    { headers: NO_CACHE_HEADERS },
  )
  return res !== undefined && res.ok
}

/**
 * True when `name@version` is recorded in the crates.io sparse index.
 */
export async function checkCrateLive(
  name,
  version,
  fetchImpl = fetch,
  logError = console.error,
) {
  const res = await fetchOk(
    `https://index.crates.io/${crateIndexPath(name)}`,
    fetchImpl,
    logError,
  )
  if (res === undefined || !res.ok) {
    return false
  }
  return indexHasVersion(await res.text(), version)
}

/**
 * The whole gate: plan from the manifests at `rootDir`, probe the registry
 * for the tag's version, return the process exit code. Injectable fetch +
 * loggers keep it drivable end-to-end by the unit suite with the network
 * closed.
 */
export async function runGate({
  fetchImpl = fetch,
  log = console.log,
  logError = console.error,
  rootDir = REPO_ROOT,
  tag = process.env.TAG,
} = {}) {
  if (!tag) {
    logError(
      '× TAG is not set — the registry-liveness gate needs the release tag.\n' +
        '  Fix: run via github-release.yml, which exports TAG from the resolved tag.',
    )
    return 1
  }
  const version = versionFromTag(tag)
  let plan
  try {
    plan = planGate(rootDir)
  } catch (error) {
    // Zero-dep on purpose — the lib errorMessage helper is not on disk when
    // this runs, so surface the plain message.
    logError(String(error?.message ?? error))
    return 1
  }
  if (plan.registry === 'npm') {
    if (!(await checkNpmLive(plan.name, version, fetchImpl, logError))) {
      logError(
        `× ${plan.name}@${version} is not resolvable on npm — refusing to cut the GH release before the registry publish.`,
      )
      logError(
        '  A STAGED package is not published. Fix: approve/complete the publish first, then re-run.',
      )
      return 1
    }
    log(`✓ ${plan.name}@${version} is live on npm.`)
    return 0
  }
  if (plan.registry === 'crates') {
    if (plan.names.length === 0) {
      log(
        'No publishable crate in the workspace — skipping the crates.io liveness gate.',
      )
    }
    for (let i = 0, { length } = plan.names; i < length; i += 1) {
      const name = plan.names[i]
      if (!(await checkCrateLive(name, version, fetchImpl, logError))) {
        logError(
          `× ${name}@${version} is not in the crates.io index — refusing to cut the GH release before the registry publish.`,
        )
        return 1
      }
      log(`✓ ${name}@${version} is live on crates.io.`)
    }
    return 0
  }
  log(
    'No public npm package or crate manifest — skipping the registry-liveness gate (github-release-only repo).',
  )
  return 0
}

async function main() {
  process.exitCode = await runGate()
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
  void main()
}
