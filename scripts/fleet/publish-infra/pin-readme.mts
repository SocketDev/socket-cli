/**
 * @file Publish-time README asset pin — registry-agnostic (npm AND cargo). A
 *   registry renders a package's README (npmjs.com for npm; crates.io + docs.rs
 *   for cargo), and RELATIVE image paths (`assets/…svg` — the coverage badge,
 *   the social-media / brand follow badges) only resolve when viewing the repo
 *   on GitHub; on the registry page they 404. The fix: in the PUBLISHED
 *   artifact only (npm tarball / `.crate`), rewrite relative asset refs to an
 *   absolute raw-GitHub URL pinned to the release-tag COMMIT SHA
 *   (`…/<tag-sha>/assets/…` — the sha is the truly immutable ref: a tag can be
 *   deleted or re-pointed, a commit sha cannot), falling back to the tag name
 *   (`…/v<version>/assets/…`) when the tag doesn't exist locally yet (a
 *   dry-run pack, or `--direct` mode where ensureTagAndRelease runs after the
 *   publish) so the badge is immutable + matches exactly what shipped. The
 *   committed README
 *   keeps relative paths (GitHub renders those live at HEAD, and the badge
 *   generators/checks key on the relative form) — so this is applied around the
 *   pack/publish and restored after (try/finally). Why pack-time +
 *   orchestrator-driven (not a prepack hook): the fleet npm publish runs `pnpm
 *   stage publish --ignore-scripts`, so lifecycle hooks never fire; and npm
 *   `--approve` re-packs locally to integrity-compare against the staged
 *   tarball, so BOTH packs must see the same pinned README or the gate trips on
 *   a content diff. For cargo, crates.io embeds the README from disk at `cargo
 *   publish`/`cargo package` time, and cargo refuses a VCS-dirty tree — so the
 *   bracketed publish passes `--allow-dirty` when (and only when) a pin was
 *   written (the [`withPinnedReadme`] callback receives that flag). Pure
 *   helpers here; the pin/restore bracket wraps each registry's pack.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runCapture } from './shared.mts'

// The GitHub owner/repo from a package.json `repository` field (string or
// `{ url }`), tolerating the common `git+https://…`, `git@github.com:…`, and
// bare `owner/repo` shapes. Returns `undefined` when it isn't a GitHub repo we
// can pin against (caller then skips pinning — fail-open, never a bad URL).
export function parseGitHubSlug(
  repository: string | { url?: string | undefined } | undefined,
): string | undefined {
  const raw =
    typeof repository === 'string' ? repository : (repository?.url ?? '')
  if (!raw) {
    return undefined
  }
  // git@github.com:owner/repo(.git) | https://github.com/owner/repo(.git) |
  // git+https://github.com/owner/repo(.git)
  const m =
    /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(raw) ??
    /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(raw)
  if (!m) {
    return undefined
  }
  return `${m[1]}/${m[2]}`
}

/**
 * The `raw.githubusercontent.com` base (trailing slash) for a repo slug + git
 * ref, e.g. `SocketDev/socket-lib` + `v1.2.3` →
 * `https://raw.githubusercontent.com/SocketDev/socket-lib/v1.2.3/`.
 */
export function rawBaseUrl(slug: string, ref: string): string {
  return `https://raw.githubusercontent.com/${slug}/${ref}/`
}

/**
 * Rewrite the README's RELATIVE `assets/…` refs (both `<img src="assets/…">`
 * and markdown `](assets/…)`) to absolute `${baseUrl}assets/…`. Absolute refs
 * (the socket.dev badge, any https link) are untouched — only the leading
 * `assets/` sentinel is matched. Idempotent: an already-absolute ref has no
 * leading `assets/` to match. Pure.
 */
export function pinReadmeAssets(readme: string, baseUrl: string): string {
  return readme
    .replaceAll('src="assets/', `src="${baseUrl}assets/`)
    .replaceAll('](assets/', `](${baseUrl}assets/`)
}

// A full git commit sha — the only thing we'll pin a raw URL to besides the
// tag name itself.
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/ // socket-lint: allow uncommented-regex

/**
 * The commit sha the local tag `tag` points at, or undefined when the tag
 * doesn't exist (or the sha can't be read). Probes existence first with
 * `show-ref --verify --quiet` — silent on both streams, so the EXPECTED
 * missing-tag case (a dry-run pack, `--direct` mode) doesn't spray a
 * `fatal: ambiguous argument` into the publish output (runCapture inherits
 * stderr by design). `git rev-list -n1` then PEELS annotated tags to their
 * commit — `rev-parse` would return the tag object's own sha, which
 * raw.githubusercontent does not serve.
 */
export async function resolveTagCommitSha(
  rootPath: string,
  tag: string,
): Promise<string | undefined> {
  const probe = await runCapture(
    'git',
    ['show-ref', '--tags', '--verify', '--quiet', `refs/tags/${tag}`],
    rootPath,
  )
  if (probe.code !== 0) {
    return undefined
  }
  const r = await runCapture('git', ['rev-list', '-n1', tag], rootPath)
  const sha = r.stdout.trim()
  return r.code === 0 && COMMIT_SHA_RE.test(sha) ? sha : undefined
}

export interface PinTarget {
  // Repo-root-relative README path (default 'README.md').
  readmePath?: string | undefined
  // package.json `repository` (string or { url }).
  repository: string | { url?: string | undefined } | undefined
  // Injectable tag→commit-sha resolver (tests); defaults to
  // resolveTagCommitSha (a real `git rev-list -n1` in rootPath).
  resolveTagSha?:
    | ((rootPath: string, tag: string) => Promise<string | undefined>)
    | undefined
  // Repo root the README + pack run from.
  rootPath: string
  // The release version being published (bare, e.g. '1.2.3'); pinned to tag
  // `v<version>`'s commit sha (tag-name fallback pre-tag).
  version: string
}

/**
 * Run `fn(pinned)` with the on-disk README temporarily pinned to the release
 * tag's COMMIT SHA — the truly immutable ref: a tag can be deleted or
 * force-moved after the fact, a commit sha cannot. The release pipeline tags
 * at its `release` stage BEFORE the publish pipeline packs, so the tag
 * normally resolves locally; when it doesn't yet exist — dry-run packs, or
 * `--direct` mode where the tag lands post-publish — the pin falls back to
 * the `v<version>` tag name so both packs of one release still agree. Then
 * ALWAYS restore the original bytes (try/finally). `pinned` is `true`
 * only when a rewrite was actually written — cargo callers use it to pass
 * `--allow-dirty` exactly when the README is the sole dirty file, and no wider.
 * No-op (runs `fn(false)` untouched) when the repo isn't a pinnable GitHub
 * repo, the README is absent, or it has no relative asset refs — pinning is a
 * hygiene nicety, never a publish blocker. Returns `fn`'s result.
 */
export async function withPinnedReadme<T>(
  target: PinTarget,
  fn: (pinned: boolean) => Promise<T>,
): Promise<T> {
  const readmePath = path.join(
    target.rootPath,
    target.readmePath ?? 'README.md',
  )
  const slug = parseGitHubSlug(target.repository)
  let original: string | undefined
  if (slug) {
    try {
      original = readFileSync(readmePath, 'utf8')
    } catch {
      original = undefined
    }
  }
  if (original === undefined) {
    // Not pinnable (no slug or no README) — publish the artifact as-is.
    return await fn(false)
  }
  const tagName = `v${target.version}`
  const resolveSha = target.resolveTagSha ?? resolveTagCommitSha
  const ref = (await resolveSha(target.rootPath, tagName)) ?? tagName
  const pinnedReadme = pinReadmeAssets(original, rawBaseUrl(slug!, ref))
  if (pinnedReadme === original) {
    // No relative asset refs to pin — skip the write/restore churn.
    return await fn(false)
  }
  writeFileSync(readmePath, pinnedReadme)
  try {
    return await fn(true)
  } finally {
    writeFileSync(readmePath, original)
  }
}
