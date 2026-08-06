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
 *   badge generators already commit their refs absolute at HEAD (see
 *   `_shared/github-raw-url.mts`), leaving no `assets/` prefix for this pass to
 *   match, so it is a no-op on them and catches only the relative refs a README
 *   still hand-carries. Applied around the
 *   pack/publish and restored after (try/finally). Why pack-time +
 *   orchestrator-driven, not a prepack hook: the fleet npm publish runs `pnpm
 *   stage publish --ignore-scripts`, so lifecycle hooks never fire; and npm
 *   `--approve` re-packs locally to integrity-compare against the staged
 *   tarball, so BOTH packs must see the same pinned README or the gate trips on
 *   a content diff. For cargo, crates.io embeds the README from disk at `cargo
 *   publish`/`cargo package` time, and cargo refuses a VCS-dirty tree — so the
 *   bracketed publish passes `--allow-dirty` when, and only when, a pin was
 *   written (the [`withPinnedReadme`] callback receives that flag). Pure
 *   helpers here; the pin/restore bracket wraps each registry's pack.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { parseFragment } from 'parse5'

import { runCapture } from './shared.mts'
import { parseGitHubSlug, rawBaseUrl } from '../_shared/github-raw-url.mts'
import { parseMarkdownGfm } from '../_shared/markdown-ast.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

import type { Definition, Image, Link, Nodes } from 'mdast'

// The relative-ref sentinel: only urls/attribute values with this exact
// leading path are pinned; absolute refs never start with it, which is also
// what makes the rewrite idempotent.
const RELATIVE_PREFIX = 'assets/'
const PINNED_ATTRS = new Set(['src', 'srcset'])

interface Parse5AttrLocation {
  endOffset: number
  startOffset: number
}

interface Parse5Node {
  attrs?: Array<{ name: string; value: string }>
  childNodes?: Parse5Node[]
  content?: Parse5Node
  sourceCodeLocation?: {
    attrs?: Record<string, Parse5AttrLocation>
  } | null
}

/** Visit every element (attrs-bearing node) in a parse5 tree, templates included. */
function walkParse5(node: Parse5Node, visit: (element: Parse5Node) => void): void {
  if (Array.isArray(node.attrs)) {
    visit(node)
  }
  if (node.content) {
    walkParse5(node.content, visit)
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      walkParse5(child, visit)
    }
  }
}

/**
 * An image, link, or definition node carries its destination in `url` and its
 * own span in `position`. The destination is the last occurrence of that url
 * inside the span (label text precedes it), so the insertion point derives
 * from the node position rather than a scan of the document.
 */
function markdownUrlOffset(
  readme: string,
  node: Definition | Image | Link,
): number | undefined {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start === undefined || end === undefined) {
    return undefined
  }
  const urlAt = readme.slice(start, end).lastIndexOf(node.url)
  return urlAt === -1 ? undefined : start + urlAt
}

/**
 * Byte offsets of relative `src`/`srcset` attribute values inside an mdast
 * `html` node's source slice, from parse5's per-attribute source locations.
 */
function htmlAttrOffsets(html: string, nodeStart: number): number[] {
  const offsets: number[] = []
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
  walkParse5(fragment as Parse5Node, element => {
    const attrLocations = element.sourceCodeLocation?.attrs
    if (!attrLocations || !element.attrs) {
      return
    }
    for (const attr of element.attrs) {
      if (
        !PINNED_ATTRS.has(attr.name) ||
        !attr.value.startsWith(RELATIVE_PREFIX)
      ) {
        continue
      }
      const location = attrLocations[attr.name]
      if (!location) {
        continue
      }
      const attrText = html.slice(location.startOffset, location.endOffset)
      const valueAt = attrText.indexOf(attr.value, attr.name.length)
      if (valueAt === -1) {
        continue
      }
      offsets.push(nodeStart + location.startOffset + valueAt)
    }
  })
  return offsets
}

/**
 * Rewrite the README's RELATIVE `assets/…` refs (markdown images/links/
 * definitions and raw-HTML `src`/`srcset` attributes) to absolute
 * `${baseUrl}assets/…`. Absolute refs (the socket.dev badge, any https link)
 * are untouched, and the rewrite is idempotent — an already-absolute ref has
 * no leading `assets/` to pin. Parsed, not pattern-matched: the README goes
 * through a position-tracked GFM mdast parse and each edit lands on a
 * parser-reported byte offset, so an `assets/` lookalike inside a fenced code
 * block or inline code span is content and stays as written; raw HTML arrives
 * as mdast `html` nodes whose source slices go through parse5 with source
 * locations on, so only real attribute values are touched. No serializer
 * round-trip — untouched bytes stay byte-identical. Pure.
 */
export function pinReadmeAssets(readme: string, baseUrl: string): string {
  const insertAt: number[] = []
  const visit = (node: Nodes): void => {
    if (
      (node.type === 'image' ||
        node.type === 'link' ||
        node.type === 'definition') &&
      node.url.startsWith(RELATIVE_PREFIX)
    ) {
      const offset = markdownUrlOffset(readme, node)
      if (offset !== undefined) {
        insertAt.push(offset)
      }
    } else if (node.type === 'html') {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      if (start !== undefined && end !== undefined) {
        insertAt.push(...htmlAttrOffsets(readme.slice(start, end), start))
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }
  visit(parseMarkdownGfm(readme))
  let pinned = readme
  for (const offset of [...new Set(insertAt)].sort((a, b) => b - a)) {
    pinned = pinned.slice(0, offset) + baseUrl + pinned.slice(offset)
  }
  return pinned
}

// A full git commit sha — the only thing we'll pin a raw URL to besides the
// tag name itself.
// oxlint-disable-next-line socket/require-regex-comment -- described above
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/

/**
 * The commit sha the local tag `tag` points at, or undefined when the tag
 * doesn't exist, or the sha can't be read. Probes existence first with
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
  // `v<version>`'s commit sha, tag-name fallback pre-tag.
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
  writeThroughMirrorLock(readmePath, pinnedReadme)
  try {
    return await fn(true)
  } finally {
    writeThroughMirrorLock(readmePath, original)
  }
}
