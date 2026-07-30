/**
 * @file Single source of truth for "which upstreams are COPYLEFT, and which of
 *   their paths may an agent read?" — shared by the `no-copyleft-source-read`
 *   Claude hook, a PreToolUse block on every route to a copyleft
 *   implementation, and the `copyleft-slices-are-tests-only` check script, so
 *   the write-time guard and the commit-time belt can never disagree.
 *   The boundary this module encodes: a copyleft upstream may be RUN as a tool
 *   and OBSERVED through its own tests — those are behavior, not
 *   implementation — but its implementation must never be read, copied, or
 *   derived into fleet code. Reading it makes the consuming package a
 *   derivative work and forces the upstream's license onto it. The motivating
 *   posture is `@socketsecurity/scan-patterns`, which pins trufflehog as a
 *   coverage ORACLE behind a tests-only sparse checkout and derives its actual
 *   detection tables from a permissively licensed source instead.
 *   ADDING AN ENTRY: the `spdx` field is the PINNED EXPECTATION, and it must be
 *   verified before it is recorded — from the upstream repo's own `LICENSE`
 *   file, corroborated by Socket's license data for the entry's `purl`. Never
 *   from memory, a package-index summary, or a sibling project's claim. A wrong
 *   SPDX id here either strands a permissive upstream behind a block or, far
 *   worse, waves a copyleft one through. `copyleft-licenses-are-current.mts` is
 *   the standing watchdog on that pin: it re-reads Socket's license data and
 *   fails loud when reality has drifted from the pin. That drift is not
 *   hypothetical — trufflehog itself relicensed GPL-2.0 to AGPL-3.0 at v3.0,
 *   and an upstream quietly changing license is exactly what poisons a
 *   derivation months later.
 *   Record the permissive alternative when one exists so the block names the
 *   road ahead rather than only the wall. Keep `testPathPatterns` TIGHT: a
 *   pattern that is too broad silently re-opens the implementation, and erring
 *   narrow only costs an explicit bypass.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * One copyleft upstream and the slice of it that stays observable.
 */
export interface CopyleftUpstream {
  // The GitHub owner/org that hosts the upstream.
  readonly owner: string
  // A short `owner/repo (SPDX)` pointer at a permissively licensed project
  // covering the same ground, when one is known. The guard surfaces it as the
  // Fix line so a blocked read has somewhere to go.
  readonly permissiveAlternative?: string | undefined
  // The VERSIONLESS package URL that identifies this upstream to Socket's
  // license data. The licenses-are-current watchdog appends a version before
  // querying, so the identity here stays stable across releases.
  readonly purl: string
  // The GitHub repo name, which is also the `upstream/<repo>` submodule dir.
  readonly repo: string
  // The SPDX id read from the upstream's own LICENSE file, corroborated by
  // Socket's license data. This is the pinned expectation the watchdog checks
  // reality against.
  readonly spdx: string
  // Repo-relative globs for the TEST slice — the only implementation-adjacent
  // paths a tests-only sparse checkout may admit. `**` spans directories, `*`
  // stops at a separator.
  readonly testPathPatterns: readonly string[]
  // The version at which `spdx` was last confirmed against Socket's license
  // data. The watchdog queries this version as a regression anchor and the
  // upstream's newest release as the drift probe.
  readonly verifiedVersion: string
}

/**
 * The copyleft upstreams the fleet treats as run-and-observe-only. Seeded with
 * ONE verified entry; every addition follows the SPDX-verification rule in this
 * file's header. Sorted by `owner/repo`.
 */
export const COPYLEFT_UPSTREAMS: readonly CopyleftUpstream[] = [
  {
    owner: 'trufflesecurity',
    permissiveAlternative: 'gitleaks/gitleaks (MIT)',
    // Go module path `github.com/trufflesecurity/trufflehog/v3`, confirmed
    // against the Go module proxy's `@latest` metadata.
    purl: 'pkg:golang/github.com/trufflesecurity/trufflehog/v3',
    repo: 'trufflehog',
    // Verified 2026-07-29 two ways: the GitHub API's `license.spdx_id` for the
    // repo's own LICENSE, and Socket's license data for the purl below.
    spdx: 'AGPL-3.0',
    // Go's universal test conventions: `_test.go` siblings and `testdata/`
    // fixture trees. Everything else in the tree is implementation.
    //
    // VERIFIED against the real tree at the version below by enumerating it
    // through the GitHub trees API, which is structure, not content: of 3467
    // blobs these two globs admit 1991 — 1973 `_test.go` files and 18
    // `testdata/` fixtures — and the `testdata/` hits are all genuine fixture
    // data. The only test-shaped paths left outside are deliberate: a compiled
    // `utf16_test.dll`, a `test_helpers.go` that is compiled into the shipping
    // package rather than the test binary, and the `scripts/test*` CI harness.
    // None is needed to observe detection behavior. No other fixture corpus
    // lives under a different directory name.
    testPathPatterns: ['**/*_test.go', '**/testdata/**'],
    verifiedVersion: 'v3.96.0',
  },
]

/**
 * Paths that are metadata, never implementation, and stay readable in EVERY
 * copyleft upstream. `LICENSE` is load-bearing: this module's own rule is that
 * a new entry's SPDX id must be verified from the upstream's LICENSE, so
 * blocking that read would make the rule unfollowable. Sorted alpha.
 *
 * 🚨 EVERY ENTRY IS ROOT-ANCHORED WITH A LEADING `/`, and must stay that way.
 * These patterns are emitted verbatim into a `git sparse-checkout set
 * --no-cone` cone, where gitignore semantics apply: a pattern with NO slash
 * matches at ANY depth. An unanchored `NOTICE*` / `README*` therefore reaches
 * far past the repo root, and on a case-insensitive filesystem — the macOS and
 * Windows default — it also matches lowercase. Together those two facts
 * materialized real AGPL implementation files, `pkg/detectors/noticeable/…`
 * and `pkg/detectors/readme/…`, inside a slice whose entire purpose is that
 * they cannot exist. The leading `/` is the fix and the invariant.
 */
export const COPYLEFT_METADATA_PATTERNS: readonly string[] = [
  '/AUTHORS*',
  '/CONTRIBUTORS*',
  '/COPYING*',
  '/COPYRIGHT*',
  '/LICENCE*',
  '/LICENSE*',
  '/NOTICE*',
  '/README*',
]

/**
 * How a blocked read was reaching the implementation. The guard prints it as
 * the Where line.
 */
export type CopyleftReadRoute =
  | 'archive-url'
  | 'gh-api-contents'
  | 'raw-url'
  | 'sparse-widen'
  | 'submodule-path'
  | 'web-url'

/**
 * A detected copyleft implementation read: which upstream, which path, and the
 * route that would have reached it.
 */
export interface CopyleftReadFinding {
  // The repo-relative path inside the upstream, or '' when the route targets
  // the whole tree, an archive download or a widened sparse cone.
  readonly path: string
  readonly route: CopyleftReadRoute
  readonly upstream: CopyleftUpstream
}

// Translate one repo-relative glob into an anchored regex. `**/` may match zero
// directories so `**/*_test.go` also covers a top-level `main_test.go`; a lone
// `*` stops at a separator; every other character is literal.
function copyleftGlobToRegExp(pattern: string): RegExp {
  // gitignore semantics, mirrored EXACTLY, because the very same string is
  // handed to `git sparse-checkout set --no-cone`: a leading `/` anchors the
  // pattern to the repo root, and a pattern carrying no slash at all floats to
  // any depth. Diverging here would let the predicate call a path unobservable
  // while git happily materializes it — the drift that leaked AGPL detector
  // files onto disk.
  const anchored = pattern.startsWith('/')
  const body = anchored ? pattern.slice(1) : pattern
  let source = anchored || body.includes('/') ? '^' : '^(?:[^\\0]*\\/)?'
  for (let i = 0, { length } = body; i < length; i += 1) {
    const ch = body[i]!
    if (ch === '*') {
      const isDoubleStar = body[i + 1] === '*'
      if (isDoubleStar && body[i + 2] === '/') {
        // `**/` — any number of leading path segments, including none.
        source += '(?:[^\\0]*\\/)?'
        i += 2
      } else if (isDoubleStar) {
        // Trailing `**` — the rest of the path, separators included.
        source += '[^\\0]*'
        i += 1
      } else {
        source += '[^/]*'
      }
    } else if (ch === '/') {
      source += '\\/'
    } else {
      // Escape every regex metacharacter so a literal `.` stays literal.
      source += ch.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

/**
 * True when `relPath`, a path relative to the upstream's own repo root, is on
 * the observable slice — a test path or a license/readme metadata file. Every
 * other path in a copyleft upstream is implementation.
 */
export function isCopyleftObservablePath(
  upstream: CopyleftUpstream,
  relPath: string,
): boolean {
  const normalized = normalizePath(relPath).replace(/^\.?\//, '')
  if (normalized === '') {
    // The tree root itself is not a file read; a directory listing is
    // metadata, so it stays observable.
    return true
  }
  const { testPathPatterns } = upstream
  for (let i = 0, { length } = testPathPatterns; i < length; i += 1) {
    if (copyleftGlobToRegExp(testPathPatterns[i]!).test(normalized)) {
      return true
    }
  }
  for (let i = 0, { length } = COPYLEFT_METADATA_PATTERNS; i < length; i += 1) {
    if (copyleftGlobToRegExp(COPYLEFT_METADATA_PATTERNS[i]!).test(normalized)) {
      return true
    }
  }
  return false
}

/**
 * True when a DIRECTORY inside a copyleft upstream may be searched wholesale —
 * a grep or glob rooted there reads every file under it, so the whole subtree
 * has to be observable, not just the directory entry. The upstream root is
 * never a searchable scope: it holds the implementation. A probe child is
 * classified in place of the real, unknown children, which is exactly right
 * for a fixture tree such as `testdata/` where every child is a fixture.
 */
export function isCopyleftObservableScope(
  upstream: CopyleftUpstream,
  relPath: string,
): boolean {
  const normalized = normalizePath(relPath).replace(/^\.?\//, '')
  if (normalized === '') {
    return false
  }
  return (
    isCopyleftObservablePath(upstream, normalized) ||
    isCopyleftObservablePath(upstream, `${normalized}/probe`)
  )
}

/**
 * The copyleft upstream whose submodule directory name is `repo`, or undefined.
 * Directory name, not `owner/repo`, because a local `upstream/<repo>` path
 * carries no owner.
 */
export function findCopyleftUpstreamByRepo(
  repo: string,
): CopyleftUpstream | undefined {
  for (let i = 0, { length } = COPYLEFT_UPSTREAMS; i < length; i += 1) {
    if (COPYLEFT_UPSTREAMS[i]!.repo === repo) {
      return COPYLEFT_UPSTREAMS[i]
    }
  }
  return undefined
}

/**
 * The copyleft upstream matching an `owner/repo` slug, case-insensitively —
 * GitHub treats both segments as case-insensitive, so a `TruffleSecurity/…`
 * URL must not slip past.
 */
export function findCopyleftUpstreamBySlug(
  owner: string,
  repo: string,
): CopyleftUpstream | undefined {
  const lowerOwner = owner.toLowerCase()
  const lowerRepo = repo.toLowerCase()
  for (let i = 0, { length } = COPYLEFT_UPSTREAMS; i < length; i += 1) {
    const entry = COPYLEFT_UPSTREAMS[i]!
    if (
      entry.owner.toLowerCase() === lowerOwner &&
      entry.repo.toLowerCase() === lowerRepo
    ) {
      return entry
    }
  }
  return undefined
}

// Strip a `.git` suffix a clone-style URL carries on the repo segment.
function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo
}

/**
 * Detect a read of a copyleft implementation through a LOCAL path — an
 * `upstream/<repo>/…` working-tree path, wherever it sits in the string, so an
 * absolute `/Users/x/proj/upstream/trufflehog/pkg/…` matches the same as the
 * repo-relative form.
 */
export function detectCopyleftPathRead(
  target: string,
): CopyleftReadFinding | undefined {
  const normalized = normalizePath(target)
  // `(?:^|\/)` anchors the segment so `my-upstream/` does not match;
  // `upstream\/([^/]+)` captures the submodule dir; `(?:\/(.*))?` captures the
  // repo-relative remainder, absent when the path IS the submodule root.
  const match = /(?:^|\/)upstream\/([^/]+)(?:\/(.*))?$/.exec(normalized)
  if (!match) {
    return undefined
  }
  const upstream = findCopyleftUpstreamByRepo(match[1]!)
  if (!upstream) {
    return undefined
  }
  const relPath = match[2] ?? ''
  if (isCopyleftObservablePath(upstream, relPath)) {
    return undefined
  }
  return { path: relPath, route: 'submodule-path', upstream }
}

/**
 * Detect a read of a copyleft implementation through a NETWORK route: a
 * `raw.githubusercontent.com` blob, a `github.com/<o>/<r>/{blob,raw}` page, a
 * `gh api repos/<o>/<r>/contents/<path>` read, or a whole-tree archive from
 * `codeload.github.com` / `github.com/<o>/<r>/archive`. An archive pulls the
 * entire implementation, so it never resolves to an observable path.
 */
export function detectCopyleftUrlRead(
  target: string,
): CopyleftReadFinding | undefined {
  // Separator-normalized once, up front: every pattern below is separator
  // sensitive, and a backslash-spelled URL must not slip past the host match.
  // The `https://` double slash collapsing to `https:/` is harmless — no
  // pattern anchors on the scheme.
  const url = normalizePath(target)
  // codeload serves NOTHING but whole-tree downloads, so any owner/repo path on
  // that host is an archive regardless of the trailing format segment
  // (`tar.gz`, `zip`, `legacy.tar.gz`, …).
  const codeload = /codeload\.github\.com\/([^/]+)\/([^/]+)(?:\/|$)/.exec(url)
  if (codeload) {
    const upstream = findCopyleftUpstreamBySlug(
      codeload[1]!,
      stripGitSuffix(codeload[2]!),
    )
    if (upstream) {
      return { path: '', route: 'archive-url', upstream }
    }
  }
  // Whole-tree downloads off the main hosts: the `/archive/` + `/tarball/` +
  // `/zipball/` endpoints. `([^/]+)\/([^/]+)` are owner and repo.
  const archive =
    /(?:api\.github\.com\/repos|github\.com)\/([^/]+)\/([^/]+)\/(?:archive|tarball|zipball)(?:\/|$)/.exec(
      url,
    )
  if (archive) {
    const upstream = findCopyleftUpstreamBySlug(
      archive[1]!,
      stripGitSuffix(archive[2]!),
    )
    if (upstream) {
      return { path: '', route: 'archive-url', upstream }
    }
  }
  // `gh api repos/<owner>/<repo>/contents/<path>` and the equivalent
  // `api.github.com` URL. The optional `api.github.com/` prefix lets the same
  // pattern serve the CLI arg and the raw URL.
  const contents =
    /(?:api\.github\.com\/)?repos\/([^/]+)\/([^/]+)\/contents\/([^\s?#]*)/.exec(
      url,
    )
  if (contents) {
    const upstream = findCopyleftUpstreamBySlug(
      contents[1]!,
      stripGitSuffix(contents[2]!),
    )
    if (upstream && !isCopyleftObservablePath(upstream, contents[3]!)) {
      return { path: contents[3]!, route: 'gh-api-contents', upstream }
    }
  }
  // `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` — the ref segment
  // is dropped, only the repo-relative remainder is classified.
  const raw =
    /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/([^\s?#]*)/.exec(url)
  if (raw) {
    const upstream = findCopyleftUpstreamBySlug(
      raw[1]!,
      stripGitSuffix(raw[2]!),
    )
    if (upstream && !isCopyleftObservablePath(upstream, raw[3]!)) {
      return { path: raw[3]!, route: 'raw-url', upstream }
    }
  }
  // `github.com/<owner>/<repo>/{blob,raw}/<ref>/<path>` — the web file viewer
  // and its raw redirect, both of which render implementation source.
  const web =
    /github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/[^/]+\/([^\s?#]*)/.exec(url)
  if (web) {
    const upstream = findCopyleftUpstreamBySlug(
      web[1]!,
      stripGitSuffix(web[2]!),
    )
    if (upstream && !isCopyleftObservablePath(upstream, web[3]!)) {
      return { path: web[3]!, route: 'web-url', upstream }
    }
  }
  return undefined
}

/**
 * Detect a wholesale SEARCH of a copyleft implementation — a grep root or a
 * glob whose wildcard-free prefix lands inside `upstream/<repo>`. The prefix
 * before the first wildcard is the real scope: `upstream/trufflehog/**‍/*.go`
 * searches the entire tree even though no literal implementation path appears.
 */
export function detectCopyleftScopeRead(
  target: string,
): CopyleftReadFinding | undefined {
  const wildcard = target.search(/[*?[]/)
  const literal = wildcard === -1 ? target : target.slice(0, wildcard)
  const normalized = normalizePath(literal).replace(/\/+$/, '')
  // Same anchoring as detectCopyleftPathRead: `(?:^|\/)` keeps `my-upstream/`
  // from matching, the first group is the submodule dir, the second the
  // repo-relative remainder.
  const match = /(?:^|\/)upstream\/([^/]+)(?:\/(.*))?$/.exec(normalized)
  if (!match) {
    return undefined
  }
  const upstream = findCopyleftUpstreamByRepo(match[1]!)
  if (!upstream) {
    return undefined
  }
  const relPath = match[2] ?? ''
  if (isCopyleftObservableScope(upstream, relPath)) {
    return undefined
  }
  return { path: relPath, route: 'submodule-path', upstream }
}

/**
 * True when a git sparse-checkout pattern keeps a copyleft submodule's cone
 * inside its tests slice. Only a pattern that IS one of the recorded
 * test/metadata globs qualifies — an arbitrary cone pattern cannot be proven a
 * subset of them, and the fail-safe direction for a license boundary is to
 * block and make the operator name the allowlist explicitly.
 */
export function isCopyleftSparsePatternAllowed(
  upstream: CopyleftUpstream,
  pattern: string,
): boolean {
  // Compared VERBATIM, with no leading-slash stripping. The anchor is part of
  // the pattern's meaning here: `/README*` admits one root file, while the
  // unanchored `README*` floats to every depth and drags implementation in. An
  // allowlist that treated them as equal would wave through the exact spelling
  // that caused the leak.
  const candidate = pattern.trim()
  if (candidate === '') {
    return false
  }
  const { testPathPatterns } = upstream
  for (let i = 0, { length } = testPathPatterns; i < length; i += 1) {
    if (testPathPatterns[i] === candidate) {
      return true
    }
  }
  for (let i = 0, { length } = COPYLEFT_METADATA_PATTERNS; i < length; i += 1) {
    if (COPYLEFT_METADATA_PATTERNS[i] === candidate) {
      return true
    }
  }
  return false
}

/**
 * The tests-only `git sparse-checkout set` line that re-establishes a copyleft
 * submodule's sanctioned cone. Both the guard's Fix line and the check
 * script's remediation print this ONE string, so the command an operator is
 * handed is provably the command the matcher accepts.
 */
export function copyleftSparseRecipe(upstream: CopyleftUpstream): string {
  const patterns = [
    ...upstream.testPathPatterns,
    ...COPYLEFT_METADATA_PATTERNS,
  ].join("' '")
  return `git -C upstream/${upstream.repo} sparse-checkout set --no-cone '${patterns}'`
}

/**
 * The ONE matcher both the guard and the check script call: given a path, a
 * URL, or a command fragment, is this a read of a copyleft implementation?
 * Network routes are tried first so a URL containing `upstream/` as a path
 * segment is classified by its host, not by the local-path shape.
 */
export function detectCopyleftImplementationRead(
  target: string,
): CopyleftReadFinding | undefined {
  return detectCopyleftUrlRead(target) ?? detectCopyleftPathRead(target)
}
