/**
 * @file One owner for "where does a README image actually live on the web".
 *   A registry renders a package README with no repository to resolve a
 *   relative path against — npmjs.com and crates.io both serve the README as
 *   standalone HTML — so a committed `assets/…svg` ref shows a broken-image
 *   icon there while rendering fine on GitHub. Every committed image ref
 *   therefore has to be an absolute `raw.githubusercontent.com` URL, and that
 *   URL needs the repo's `owner/repo` slug. This module parses the slug out of
 *   a package.json `repository` field and spells the raw host, so the badge
 *   generators, their checks, and the publish-time README pin can never
 *   disagree on the URL shape.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// The git ref a COMMITTED README pins its asset URLs to. `HEAD` tracks the
// repo's default branch, so a reader always sees the badge that is currently
// committed. Note: the publish-time pin uses a release sha instead, because a
// shipped tarball wants the bytes of that release rather than today's HEAD.
export const RAW_HEAD_REF = 'HEAD'

/**
 * The GitHub owner/repo from a package.json `repository` field, which npm lets
 * a package spell either as a bare string or as an object with a `url`. The
 * common `git+https://…`, `git@github.com:…`, and bare `owner/repo` shapes all
 * parse. Returns `undefined` when it isn't a GitHub repo we can build a URL
 * against. Note: each caller decides what that means for it — an optional
 * rewrite skips itself, a generator whose output would carry a broken URL
 * fails loud.
 */
export function parseGitHubSlug(
  repository: string | { url?: string | undefined } | undefined,
): string | undefined {
  const raw =
    typeof repository === 'string' ? repository : (repository?.url ?? '')
  if (!raw) {
    return undefined
  }
  // Two shapes, tried in order: a github.com URL in any of its `git@`,
  // `https://`, and `git+https://` spellings, then a bare `owner/repo`. An
  // optional `.git` suffix and a trailing `#ref` or `?query` are trimmed off
  // either way.
  const m =
    /github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/.exec(raw) ??
    /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(raw)
  if (!m) {
    return undefined
  }
  return `${m[1]}/${m[2]}`
}

/**
 * The `raw.githubusercontent.com` base, trailing slash, for a repo slug + git
 * ref, e.g. `SocketDev/socket-lib` + `v1.2.3` →
 * `https://raw.githubusercontent.com/SocketDev/socket-lib/v1.2.3/`.
 */
export function rawBaseUrl(slug: string, ref: string): string {
  return `https://raw.githubusercontent.com/${slug}/${ref}/`
}

/**
 * The absolute URL a COMMITTED README uses for a repo-relative asset path, e.g.
 * `SocketDev/socket-lib` + `assets/coverage.svg` →
 * `https://raw.githubusercontent.com/SocketDev/socket-lib/HEAD/assets/coverage.svg`.
 */
export function rawAssetUrl(slug: string, assetPath: string): string {
  return `${rawBaseUrl(slug, RAW_HEAD_REF)}${assetPath}`
}

/**
 * The `repository` field of `<repoRoot>/package.json`, normalized to the
 * shapes [`parseGitHubSlug`] accepts. `undefined` when the file is absent,
 * unparseable, or carries no usable field.
 */
export function readRepositoryField(
  repoRoot: string,
): string | { url: string } | undefined {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const repository = (parsed as Record<string, unknown>)['repository']
  if (typeof repository === 'string') {
    return repository
  }
  if (typeof repository === 'object' && repository !== null) {
    const url = (repository as Record<string, unknown>)['url']
    return typeof url === 'string' ? { url } : undefined
  }
  return undefined
}

// The `owner/repo` slug of the repo rooted at `repoRoot`, read from its own
// package.json. `undefined` when it can't be resolved.
export function repoGitHubSlug(repoRoot: string): string | undefined {
  return parseGitHubSlug(readRepositoryField(repoRoot))
}

/**
 * Whether this package's README ever reaches a registry page. Only a published
 * package needs the absolute URL: a `private: true` package is never uploaded,
 * so its README is read on GitHub alone, where a relative path resolves for
 * anyone who can see the repo. The absolute form is actively WORSE there — a
 * private repo's `raw.githubusercontent.com` URL is not served anonymously, so
 * GitHub's image proxy gets a 404 and renders the badge broken for everyone.
 * Read from the manifest rather than the repo's GitHub visibility so the answer
 * needs no network call and is the same locally and in CI.
 */
export function isPublishedPackage(repoRoot: string): boolean {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    // An absent or unreadable manifest is not evidence of a private package.
    // Answering "published" keeps the caller on the absolute-url path, where an
    // unresolvable slug is a hard stop; answering "private" would hand back a
    // relative path and quietly reship the broken registry image.
    return true
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return true
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return true
  }
  return (parsed as Record<string, unknown>)['private'] !== true
}

/**
 * The four-ingredient error a generator prints when [`repoGitHubSlug`] comes
 * back undefined. Falling back to a relative path here would reintroduce the
 * broken-on-npm badge invisibly, so an unresolvable slug is a hard stop.
 */
export function missingGitHubSlugMessage(repoRoot: string): string {
  const field = readRepositoryField(repoRoot)
  const saw =
    field === undefined
      ? 'no usable `repository` field'
      : `\`repository\` resolved to ${JSON.stringify(
          typeof field === 'string' ? field : field.url,
        )}`
  return [
    'Cannot resolve the GitHub owner/repo the README badge URLs need.',
    `  Where: ${path.join(repoRoot, 'package.json')} — the "repository" field.`,
    `  Saw: ${saw}; wanted a GitHub URL the slug parser understands — git+https://github.com/<owner>/<repo>.git, https://github.com/<owner>/<repo>, git@github.com:<owner>/<repo>.git, or a bare <owner>/<repo>.`,
    '  Fix: add `"repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }` to package.json, then re-run. A relative badge path is not a fallback — npm has no repository to resolve it against, so it ships a broken image on the package page.',
  ].join('\n')
}
