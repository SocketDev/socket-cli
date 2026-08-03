/**
 * @file @socketsecurity/lib floor verification for the fleet install action.
 *   Decision core extracted from the inline bash `run:` block of the
 *   "Verify @socketsecurity/lib resolvable and >= floor version" step — the
 *   two `node -e` package.json probes, the lib-stable → lib alias fallback, the
 *   HARDCODED_FLOOR vs live npm-view floor comparison, and the banner-string
 *   validation. Branch shape, byte-identical stdout/stderr/exit to the old
 *   step:
 *
 *   - probe @socketsecurity/lib-stable FIRST: a repo whose PRODUCT pins or
 *     bundles an older @socketsecurity/lib — e.g. a backfill content ref
 *     rebuilding historical dist — decouples fleet tooling from that product
 *     pin via the -stable alias, the same indirection every fleet script
 *     imports through. The floor applies to whichever copy fleet tooling will
 *     actually import. A probe that resolves but reports a non-string or empty
 *     version counts as absent — exactly like the old
 *     `process.stdout.write(require(...).version)` probe, where write() threw
 *     on non-strings and the catch wrote ''.
 *   - neither package resolvable → the not-resolvable refusal on stderr, exit 1.
 *   - floor selection: NPM_LATEST — the live `npm view @socketsecurity/lib
 *     version` result, queried by the thin action step and passed via env — is
 *     the ideal floor when it is plain semver. Socket Firewall and other npm
 *     proxies sometimes intercept queries and return a banner string, which
 *     would otherwise poison the comparison — a non-semver response falls back
 *     to HARDCODED_FLOOR and names the banner, truncated to 80 chars like the
 *     old ${NPM_LATEST:0:80}; an empty response falls back and names the failed
 *     query.
 *   - a non-semver installed version → the defensive refusal on stderr, truncated
 *     to 200 chars like the old ${ACTUAL_VERSION:0:200}, exit 1.
 *   - floor comparison is major.minor.patch only, pre-release ignored —
 *     5.24.0-rc.1 satisfies a 5.24.0 floor, same as the semver.mjs `lt` mode
 *     the old step shelled out to; that helper is retired with this extraction
 *     and its regex + compare now live here.
 *   - documented divergence from the old step: the action's npm-view probe now
 *     runs BEFORE resolvability is known, so the not-resolvable failure path
 *     performs one extra npm query, bounded to 10s. Streams and exit codes are
 *     unaffected — proven old-vs-new side-by-side across 17 fixture scenarios.
 *   - co-located with the action and invoked via $GITHUB_ACTION_PATH so it
 *     travels when a member consumes the action — same shape as
 *     github-status-check's probe-github-status.mjs. Dependency-free on
 *     purpose: only `node:` builtins, runnable on the runner's system Node.
 *     Pure decision functions are exported for the wheelhouse unit suite; the
 *     thin CLI shell at the bottom reads NPM_LATEST from the env, probes the
 *     consumer repo's node_modules from the working directory, and exits
 *     non-zero on refusal. Usage: NPM_LATEST=<npm view output> node
 *     verify-lib-floor.mjs
 */

import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// The lowest version known to contain the un-stubbed pacote fetchers
// required by downloadNpmPackage — commit 320c757, shipped in 5.24.0.
// Older versions throw "this pacote fetcher is stubbed out" at runtime.
export const HARDCODED_FLOOR = '5.24.0'

export const STABLE_PKG = '@socketsecurity/lib-stable'

export const LIB_PKG = '@socketsecurity/lib'

// Plain semver: (1) major, (2) minor, (3) patch, then an optional
// prerelease/build suffix after `-` or `+`. Same regex as the retired
// colocated semver.mjs the old step shelled out to.
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]+)?$/

/**
 * The banner validation: true when the value is plain
 * MAJOR.MINOR.PATCH[-pre|+build] semver, false for proxy banner strings and
 * anything else — including multi-line values, which the anchors reject.
 */
export function isPlainSemver(value) {
  return SEMVER_RE.test(value)
}

/**
 * The floor comparison: true when a < b on major.minor.patch only,
 * pre-release ignored — semver.mjs `lt` semantics. Invalid input returns
 * false, mirroring the old `if node "$SEMVER" lt …` where the exit-2
 * invalid-input path was falsy; both callers pre-validate, so this is
 * defensive only.
 */
export function semverLt(a, b) {
  const pa = SEMVER_RE.exec(a)
  const pb = SEMVER_RE.exec(b)
  if (!pa || !pb) {
    return false
  }
  for (let i = 1; i < 4; i += 1) {
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (na !== nb) {
      return na < nb
    }
  }
  return false
}

// The old bash ${VAR:0:N} counts characters, not UTF-16 code units — spread
// to code points so astral characters in a proxy banner truncate the same.
function truncateChars(value, max) {
  return [...value].slice(0, max).join('')
}

/**
 * The alias-fallback selection: the -stable tooling alias wins when its
 * probe produced a version; otherwise fall back to @socketsecurity/lib. An
 * empty actualVersion means neither package is usable.
 */
export function selectLibPackage(stableVersion, libVersion) {
  if (stableVersion !== '') {
    return { actualVersion: stableVersion, libPkg: STABLE_PKG }
  }
  return { actualVersion: libVersion, libPkg: LIB_PKG }
}

/**
 * The floor selection fold over the npm-view result: live latest when it is
 * plain semver, otherwise the hardcoded floor with a source string naming
 * the banner (truncated to 80 chars) or the failed query.
 */
export function chooseFloor(npmLatest, hardcodedFloor = HARDCODED_FLOOR) {
  if (npmLatest !== '' && isPlainSemver(npmLatest)) {
    return { minSource: 'latest published on npm', minVersion: npmLatest }
  }
  if (npmLatest !== '') {
    return {
      minSource: `hardcoded floor (npm view returned non-semver: ${truncateChars(npmLatest, 80)})`,
      minVersion: hardcodedFloor,
    }
  }
  return {
    minSource: 'hardcoded floor (npm query failed)',
    minVersion: hardcodedFloor,
  }
}

// The refusal texts below preserve the old heredocs byte-for-byte —
// including the doubled "The the" — so consumers grepping job logs see no
// drift. Fix the wording upstream in a dedicated change, not here.
function notResolvableText(cwd, hardcodedFloor) {
  return `× @socketsecurity/lib not resolvable from ${cwd}.
  The the fleet install action requires it at runtime for
  downloadNpmPackage (used to provision agentshield and related
  tools). Expected Node's module resolver to find the package
  after \`pnpm install\` completed, but
  \`require('@socketsecurity/lib/package.json')\` failed.
  Fix: add "@socketsecurity/lib" as a pinned exact version (e.g.
  "${hardcodedFloor}", not "^${hardcodedFloor}" or "*") to your
  package.json — prefer referencing a pnpm-workspace.yaml catalog
  entry so every workspace package shares the same pin. Commit
  the updated pnpm-lock.yaml, then push and re-run the workflow.
`
}

function nonSemverActualText(libPkg, actualVersion) {
  return `× ${libPkg} package.json reports non-semver version: ${truncateChars(actualVersion, 200)}
  Expected MAJOR.MINOR.PATCH. Check the installed package's package.json.
`
}

function floorViolationText({
  actualVersion,
  hardcodedFloor,
  libPkg,
  minSource,
  minVersion,
}) {
  return `× ${libPkg} ${actualVersion} is below the required
  floor ${minVersion} (${minSource}).
  The the fleet install action requires
  ${libPkg} >= ${minVersion}; older versions either
  ship a stubbed pacote fetcher (< ${hardcodedFloor}) or are
  missing fixes consumed by downloadNpmPackage and related fleet
  tooling.
  Fix: bump "${libPkg}" in package.json (or the
  pnpm-workspace.yaml catalog entry) to "${minVersion}" — pin
  exact, not "^" or "~". A repo whose product must keep an older
  @socketsecurity/lib can instead add the tooling alias
  "@socketsecurity/lib-stable": "npm:@socketsecurity/lib@${minVersion}".
  Run \`pnpm install\`, commit pnpm-lock.yaml, then push and
  re-run the workflow.
`
}

/**
 * The whole decision: probe results in, streams + exit code out. stderrText
 * and stdoutText carry the exact bytes the old step wrote — trailing
 * newlines included — and exitCode is the step's exit status.
 */
export function planVerification({
  cwd,
  hardcodedFloor = HARDCODED_FLOOR,
  libVersion,
  npmLatest,
  stableVersion,
}) {
  const { actualVersion, libPkg } = selectLibPackage(stableVersion, libVersion)
  if (actualVersion === '') {
    return {
      exitCode: 1,
      stderrText: notResolvableText(cwd, hardcodedFloor),
      stdoutText: '',
    }
  }
  const { minSource, minVersion } = chooseFloor(npmLatest, hardcodedFloor)
  // Defensive: the installed version should always be plain semver since it
  // comes from package.json, but validate so a malformed pin produces a
  // clear error rather than a poisoned comparison.
  if (!isPlainSemver(actualVersion)) {
    return {
      exitCode: 1,
      stderrText: nonSemverActualText(libPkg, actualVersion),
      stdoutText: '',
    }
  }
  if (semverLt(actualVersion, minVersion)) {
    return {
      exitCode: 1,
      stderrText: floorViolationText({
        actualVersion,
        hardcodedFloor,
        libPkg,
        minSource,
        minVersion,
      }),
      stdoutText: '',
    }
  }
  return {
    exitCode: 0,
    stderrText: '',
    stdoutText: `${libPkg} ${actualVersion} >= ${minVersion} (${minSource})\n`,
  }
}

/**
 * The installed-version probe, resolved from the consumer repo's working
 * directory like the old `node -e` one-liners — require() finds the package
 * through node_modules, so the guard fires the same way fleet tooling would
 * actually fail at runtime. Any failure — unresolvable package, unparseable
 * package.json, non-string version — probes as '', the old catch-writes-''
 * behavior.
 */
export function probeInstalledVersion(pkgName, resolveFrom = process.cwd()) {
  try {
    const requireFromCwd = createRequire(
      path.join(resolveFrom, '__verify-lib-floor__.mjs'),
    )
    const { version } = requireFromCwd(`${pkgName}/package.json`)
    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
}

/**
 * The whole verification: probe the alias then the fallback, plan, emit.
 * Injectable probe + sinks keep it drivable end-to-end by the unit suite
 * with no fixture node_modules on disk. Returns the process exit code.
 */
export function runVerify({
  // Prefer $PWD: bash exports its logical pwd, which is what the old
  // step's `$(pwd)` printed — process.cwd() resolves symlinks.
  cwd = process.env.PWD || process.cwd(),
  npmLatest = process.env.NPM_LATEST ?? '',
  probe = probeInstalledVersion,
  writeErr = text => process.stderr.write(text),
  writeOut = text => process.stdout.write(text),
} = {}) {
  const stableVersion = probe(STABLE_PKG)
  // The old step only probed @socketsecurity/lib when the -stable alias
  // probe came back empty; keep that short-circuit.
  const libVersion = stableVersion === '' ? probe(LIB_PKG) : ''
  const plan = planVerification({ cwd, libVersion, npmLatest, stableVersion })
  if (plan.stderrText !== '') {
    writeErr(plan.stderrText)
  }
  if (plan.stdoutText !== '') {
    writeOut(plan.stdoutText)
  }
  return plan.exitCode
}

function main() {
  process.exitCode = runVerify()
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
  main()
}
