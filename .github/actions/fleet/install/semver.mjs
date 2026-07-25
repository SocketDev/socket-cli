// Composite-action helper runs on the raw runner BEFORE setup-node finishes
// resolving node_modules — `@socketsecurity/lib-stable` is not on disk yet.
// Use a tiny inline logger that mirrors the `.fail` API this script needs.
const logger = {
  // oxlint-disable-next-line socket/no-console-prefer-logger -- pre-setup-node action; @socketsecurity/lib-stable not installed yet.
  fail: msg => console.error(msg),
}

/**
 * @file Semver validate + compare for composite-action shells. Replaces inline
 *   bash regex + pure-bash version_lt(). Two modes: node lib/semver.mjs valid
 *   <version>
 *
 *   - Exit 0 if <version> matches MAJOR.MINOR.PATCH[-pre|+build].
 *   - Exit 1 otherwise (no output). node lib/semver.mjs lt <a> <b>
 *   - Exit 0 if a < b (major.minor.patch only, pre-release ignored).
 *   - Exit 1 if a >= b.
 *   - Exit 2 if either is invalid (stderr names which).
 */

// Plain semver: (1) major, (2) minor, (3) patch, then an optional
// prerelease/build suffix after `-` or `+`.
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]+)?$/

function parts(v) {
  const m = SEMVER_RE.exec(v)
  if (!m) {
    return undefined
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const [, , mode, a, b] = process.argv

if (mode === 'valid') {
  process.exit(SEMVER_RE.test(a) ? 0 : 1)
}

if (mode === 'lt') {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa) {
    logger.fail(`not semver: "${a}"`)
    process.exit(2)
  }
  if (!pb) {
    logger.fail(`not semver: "${b}"`)
    process.exit(2)
  }
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      process.exit(pa[i] < pb[i] ? 0 : 1)
    }
  }
  process.exit(1)
}

logger.fail(`unknown mode "${mode}" (expected "valid" or "lt")`)
process.exit(2)
