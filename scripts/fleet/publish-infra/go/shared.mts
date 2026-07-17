/**
 * @file Go-module publish helpers for the go-publish flow — the Go analog of
 *   publish-infra/cargo/shared.mts. Go "publishing" is NOTHING like crates.io /
 *   npm: a module is released by pushing a semver git tag (`vX.Y.Z`, or
 *   `<subdir>/vX.Y.Z` for a nested module) to the public repo; proxy.golang.org
 *   fetches it from VCS, sum.golang.org pins its checksum in an immutable
 *   transparency log, and pkg.go.dev indexes it. There is NO registry account,
 *   NO publish token, and NO name reservation — the module path IS the repo
 *   URL, which already exists once the repo is public. That last fact is WHY
 *   this directory ships NO `placeholder.mts`. The cargo / npm tiers each carry
 *   one to publish a `0.0.0` reservation that CLAIMS a name so an OIDC trusted
 *   publisher can be configured before the first real release. Go has no name
 *   to reserve: a tag pushed against an already-public repo path needs no prior
 *   claim, and there is no token/OIDC publisher to bootstrap. The absence of a
 *   go/placeholder.mts is DELIBERATE, not a gap — do not add one. This module
 *   holds the PURE, unit-tested pieces: release-tag shape validation, the tag ⇄
 *   (module dir, version) mapping, the semantic-import major-version-suffix
 *   rule, the go.mod `module` directive reader, the bang-escaped proxy `.info`
 *   URL, and the post-tag verify poll (an injectable fetcher + sleep so tests
 *   drive every path with no network). The registry-agnostic spawn/git helpers
 *   live in ../shared.mts; the proxy / GOPROXY primitives (escapeModulePath,
 *   findGoModFiles) are reused from ../../update/go.mts (1 helper, 1 home).
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'

// escapeModulePath (uppercase X → `!x`, so a case-insensitive filesystem can't
// collide two module paths) already lives + is unit-tested in ../../update/go.mts.
// Reuse it (1 helper, 1 home), then re-export below so go-publish.mts — and, via
// that, the go-publish.yml workflow — can reference the unit-tested implementation.
import { escapeModulePath } from '../../update/go.mts'

export { escapeModulePath }

// The public Go module proxy. The verify step reads it WITHOUT a `direct`
// fallback so a proxy miss surfaces as "not indexed yet", not a silent VCS hit.
export const PUBLIC_GO_PROXY = 'https://proxy.golang.org'

// Verify-poll defaults: proxy indexing is async after a tag push, so poll with
// bounded exponential backoff. Mirrors the go-publish.yml warm-and-verify loop
// (max 8 attempts, 5s initial delay, capped at 60s).
export const DEFAULT_VERIFY_MAX_ATTEMPTS = 8
export const DEFAULT_VERIFY_INITIAL_DELAY_MS = 5_000
export const VERIFY_MAX_DELAY_MS = 60_000

/**
 * A parsed release tag: the module subdir `prefix` ('' for a root module), the
 * canonical `vX.Y.Z` `version`, and the integer `major`.
 */
export interface ParsedReleaseTag {
  prefix: string
  version: string
  major: number
}

/**
 * The subset of a proxy `.info` document the verify step reads.
 */
export interface ProxyModuleInfo {
  Version?: string | undefined
  Time?: string | undefined
}

/**
 * The outcome of one proxy `.info` read: `found` is true on an HTTP 200 (with
 * the parsed `info`), false on a 404/410 miss (not indexed yet). A transport /
 * unexpected-status error rejects instead, so the poll can distinguish "not
 * ready" from "broken".
 */
export interface ProxyInfoResult {
  found: boolean
  info?: ProxyModuleInfo | undefined
}

/**
 * Reads one proxy `.info` URL. Injected in tests so no network is touched; the
 * default (`fetchProxyInfo`) goes through socket-lib's `httpRequest`.
 */
export type ProxyInfoFetcher = (url: string) => Promise<ProxyInfoResult>

/**
 * The result of a verify poll: whether the proxy served the exact version, how
 * many attempts it took, and a human detail line.
 */
export interface VerifyResult {
  ok: boolean
  attempts: number
  detail: string
}

// Optional leading `v`, then the X.Y.Z semver core. Pre-release / build
// metadata is intentionally unsupported here — a Go module release tag is a
// plain vX.Y.Z.
const SEMVER_CORE_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

// A release tag: an optional `<subdir>/` module prefix, then a vX.Y.Z core.
// Mirrors the shape validated by
// template/presets/.github/workflows/go-publish.yml.
const RELEASE_TAG_RE = /^(?:(.+)\/)?v(\d+)\.(\d+)\.(\d+)$/

// A trailing `/vN` major-version suffix on a module path (semantic import
// versioning: v2+ must carry it, v0/v1 must not).
const MAJOR_SUFFIX_RE = /\/v(\d+)$/

// The go.mod `module <path>` directive — the first token after `module`.
const MODULE_DIRECTIVE_RE = /^\s*module\s+(\S+)/m

/**
 * Canonicalize a version to `vX.Y.Z` (accepts `1.2.3` or `v1.2.3`). Returns
 * undefined when the input is not a plain vX.Y.Z. Pure.
 */
export function canonicalVersion(input: string): string | undefined {
  const m = SEMVER_CORE_RE.exec(input.trim())
  return m ? `v${m[1]}.${m[2]}.${m[3]}` : undefined
}

/**
 * The integer major of a `vX.Y.Z` (or `X.Y.Z`) version, or undefined when the
 * input is not a plain semver core. Pure.
 */
export function versionMajor(version: string): number | undefined {
  const m = SEMVER_CORE_RE.exec(version.trim())
  return m ? Number(m[1]) : undefined
}

/**
 * Whether `tag` is a valid Go release tag — `vX.Y.Z`, or `<subdir>/vX.Y.Z` for
 * a nested module. Pure.
 */
export function isValidReleaseTag(tag: string): boolean {
  return RELEASE_TAG_RE.test(tag)
}

/**
 * Split a release tag into its module `prefix` (subdir, '' for a root module),
 * canonical `version`, and integer `major`. Returns undefined for a malformed
 * tag. Pure.
 */
export function parseReleaseTag(tag: string): ParsedReleaseTag | undefined {
  const m = RELEASE_TAG_RE.exec(tag)
  if (!m) {
    return undefined
  }
  return {
    prefix: m[1] ?? '',
    version: `v${m[2]}.${m[3]}.${m[4]}`,
    major: Number(m[2]),
  }
}

/**
 * Build the release tag for a module: a root module (`moduleSubdir` `'.'` or
 * '') tags `vX.Y.Z`; a nested module tags `<subdir>/vX.Y.Z`. Returns undefined
 * when the version is not a plain vX.Y.Z. Pure.
 */
export function buildModuleTag(
  moduleSubdir: string,
  version: string,
): string | undefined {
  const canon = canonicalVersion(version)
  if (!canon) {
    return undefined
  }
  const sub = moduleSubdir
    // A root module is represented as '.' — treat it as no prefix.
    .replace(/^\.$/, '')
    // Strip a leading `./` so `./sub` and `sub` produce the same tag.
    .replace(/^\.\//, '')
    // Strip any trailing slash so the join never doubles it.
    .replace(/\/+$/, '')
  return sub ? `${sub}/${canon}` : canon
}

/**
 * The semantic-import-versioning gate: a `major` >= 2 requires the module path
 * to end with `/v<major>`; a v0/v1 module path must NOT carry a `/vN` suffix.
 * Returns an error string on a violation, else undefined. Pure — mirrors the
 * go-publish.yml major-suffix assertion.
 */
export function majorSuffixError(
  modulePath: string,
  major: number,
): string | undefined {
  const m = MAJOR_SUFFIX_RE.exec(modulePath)
  if (major >= 2) {
    if (!m || Number(m[1]) !== major) {
      return (
        `v${major} release requires the module path to end with /v${major} ` +
        `(got '${modulePath}')`
      )
    }
  } else if (m) {
    return `v0/v1 release must NOT carry a /vN suffix (got '${modulePath}')`
  }
  return undefined
}

/**
 * Read the `module <path>` directive out of a go.mod source. Returns undefined
 * when there is no module directive. Pure.
 */
export function parseModuleDirective(goModText: string): string | undefined {
  const m = MODULE_DIRECTIVE_RE.exec(goModText)
  return m ? m[1] : undefined
}

/**
 * Build the bang-escaped proxy `.info` URL for `modulePath@version`, e.g.
 * `https://proxy.golang.org/github.com/!socket!dev/x/@v/v1.2.3.info`. Both the
 * module path and the version are escaped (a version never has uppercase, but
 * escaping it keeps the transform uniform). Pure.
 */
export function proxyInfoUrl(
  proxyBase: string,
  modulePath: string,
  version: string,
): string {
  // Trim trailing slashes so the path join is clean.
  const base = proxyBase.replace(/\/+$/, '')
  return `${base}/${escapeModulePath(modulePath)}/@v/${escapeModulePath(version)}.info`
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Default proxy `.info` reader — socket-lib's `httpRequest` (the fleet "never
 * bare fetch()" rule). HTTP 200 ⇒ `{ found: true, info }`; a 404/410 miss ⇒
 * `{ found: false }` (not indexed yet); any other status throws so the poll
 * stops on a real error instead of spinning.
 */
export async function fetchProxyInfo(url: string): Promise<ProxyInfoResult> {
  const res = await httpRequest(url, { timeout: 30_000 })
  if (res.ok) {
    return { found: true, info: res.json<ProxyModuleInfo>() }
  }
  if (res.status === 404 || res.status === 410) {
    return { found: false }
  }
  throw new Error(`proxy returned ${res.status} for ${url}`)
}

/**
 * Verify the public proxy serves `modulePath@version` — the post-tag warm +
 * confirm step. Proxy indexing is async, so this polls the `.info` URL with
 * bounded exponential backoff and succeeds only when the proxy resolves the
 * EXACT version (never a v0.0.0 pseudo-version). An already-indexed version is
 * an idempotent 1-attempt success. `fetchInfo` and `sleep` are injectable so
 * tests drive every path with no network and no real delay; fail-soft — never
 * throws, returns `{ ok: false }` after `maxAttempts`.
 */
export async function verifyModuleAvailable(options: {
  modulePath: string
  version: string
  proxyBase?: string | undefined
  fetchInfo?: ProxyInfoFetcher | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  maxAttempts?: number | undefined
  initialDelayMs?: number | undefined
}): Promise<VerifyResult> {
  const opts = { __proto__: null, ...options } as typeof options
  const proxyBase = opts.proxyBase ?? PUBLIC_GO_PROXY
  const fetchInfo = opts.fetchInfo ?? fetchProxyInfo
  const sleep = opts.sleep ?? defaultSleep
  const maxAttempts = opts.maxAttempts ?? DEFAULT_VERIFY_MAX_ATTEMPTS
  const url = proxyInfoUrl(proxyBase, opts.modulePath, opts.version)
  let delay = opts.initialDelayMs ?? DEFAULT_VERIFY_INITIAL_DELAY_MS
  let attempt = 0
  let lastDetail = `not indexed yet at ${url}`
  while (attempt < maxAttempts) {
    attempt += 1
    let result: ProxyInfoResult
    try {
      // eslint-disable-next-line no-await-in-loop -- the poll is strictly sequential.
      result = await fetchInfo(url)
    } catch (e) {
      lastDetail = `proxy read error: ${errorMessage(e)}`
      result = { found: false }
    }
    if (result.found) {
      const got = result.info?.Version
      if (got === opts.version) {
        return {
          ok: true,
          attempts: attempt,
          detail: `${opts.modulePath}@${opts.version} resolved at ${url}`,
        }
      }
      lastDetail = `proxy resolved '${got ?? '<none>'}', expected '${opts.version}'`
    }
    if (attempt < maxAttempts) {
      // eslint-disable-next-line no-await-in-loop -- backoff between poll attempts.
      await sleep(delay)
      delay = Math.min(delay * 2, VERIFY_MAX_DELAY_MS)
    }
  }
  return {
    ok: false,
    attempts: attempt,
    detail:
      `${opts.modulePath}@${opts.version} not verified after ` +
      `${maxAttempts} attempt(s): ${lastDetail}`,
  }
}
