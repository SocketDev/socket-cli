/**
 * @file Publish-time README asset pin. npm renders a package's README on the
 *   package page and rewrites RELATIVE image paths (`assets/…svg`) against the
 *   repo's default branch — i.e.
 *   `raw.githubusercontent.com/<owner>/<repo>/HEAD/ assets/…`. HEAD moves, so a
 *   published (tagged) release's badge silently drifts from what shipped. The
 *   fix: in the TARBALL only, rewrite relative asset refs to the RELEASE TAG
 *   (`…/v<version>/assets/…`) so the npm badge is immutable + matches the
 *   release. The committed README keeps relative paths (GitHub renders those
 *   live at HEAD, and the badge generators/checks key on the relative form) —
 *   so this is applied around packing + restored after. Why tarball-only +
 *   orchestrator-driven (not a prepack hook): the fleet publish runs `pnpm
 *   stage publish --ignore-scripts`, so lifecycle hooks never fire. And
 *   `--approve` re-packs locally to integrity-compare against the staged
 *   tarball, so BOTH packs must see the same pinned README or the gate trips on
 *   a README content diff — hence a shared pin/restore bracket around every
 *   pack. Pure helpers here; the bracket lives in staged.mts.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

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

export interface PinTarget {
  // Repo-root-relative README path (default 'README.md').
  readmePath?: string | undefined
  // package.json `repository` (string or { url }).
  repository: string | { url?: string | undefined } | undefined
  // Repo root the README + pack run from.
  rootPath: string
  // The release version being published (bare, e.g. '1.2.3'); pinned as `v…`.
  version: string
}

/**
 * Run `fn` with the on-disk README temporarily pinned to the release tag, then
 * ALWAYS restore the original bytes (try/finally). No-op (runs `fn` untouched)
 * when the repo isn't a pinnable GitHub repo or the README is absent — pinning
 * is a hygiene nicety, never a publish blocker. Returns `fn`'s result.
 */
export async function withPinnedReadme<T>(
  target: PinTarget,
  fn: () => Promise<T>,
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
    // Not pinnable (no slug or no README) — publish the tarball as-is.
    return await fn()
  }
  const pinned = pinReadmeAssets(
    original,
    rawBaseUrl(slug!, `v${target.version}`),
  )
  if (pinned === original) {
    // No relative asset refs to pin — skip the write/restore churn.
    return await fn()
  }
  writeFileSync(readmePath, pinned)
  try {
    return await fn()
  } finally {
    writeFileSync(readmePath, original)
  }
}
