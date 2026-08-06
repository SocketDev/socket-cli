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

import { runCapture } from './shared.mts'
import { parseGitHubSlug, rawBaseUrl } from '../_shared/github-raw-url.mts'
import {
  htmlAttributeValueOffsets,
  insertAtOffsets,
  parseMarkdown,
  urlOffset,
  walkMarkdown,
} from '../lib/markdown-ast.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

// The relative-ref sentinel. Only refs with this exact leading path are
// pinned; an absolute ref never starts with it, which is also what makes the
// rewrite idempotent.
const RELATIVE_PREFIX = 'assets/'

// The raw-HTML attributes that carry an asset ref: `src` on `<img>`, `srcset`
// on the `<picture><source>` dark/light variants.
const PINNED_ATTRS = new Set(['src', 'srcset'])

/**
 * Rewrite the README's RELATIVE `assets/…` refs to absolute
 * `${baseUrl}assets/…`. Covers every form a ref actually takes: markdown
 * images, links and reference-style definitions, plus raw-HTML `src` and
 * `srcset` attributes — anywhere they occur, including inside tables,
 * footnotes, blockquotes and list items. Absolute refs (the socket.dev badge,
 * any https link) are untouched, and the rewrite is idempotent: an
 * already-absolute ref has no leading `assets/` to pin.
 *
 * Parsed, not pattern-matched. The README goes through a position-tracked GFM
 * mdast parse and every edit lands on a parser-reported byte offset, so an
 * `assets/` lookalike inside a fenced code block or an inline code span is
 * CONTENT and stays as written — the string rewrite this replaces pinned those
 * too, corrupting a README that documents its own badge markup. Raw HTML
 * arrives as an opaque `html` node whose source slice goes through parse5 with
 * source locations on, so only real attribute values move. No serializer
 * round-trip — untouched bytes stay byte-identical. Pure.
 *
 * One deliberate limit: a `srcset` CANDIDATE LIST (`assets/a.png 1x, …`) pins
 * only its first candidate, matching what the fleet's single-candidate
 * `<source srcset>` usage needs.
 */
export function pinReadmeAssets(readme: string, baseUrl: string): string {
  const insertAt: number[] = []
  for (const node of walkMarkdown(parseMarkdown(readme))) {
    if (
      (node.type === 'definition' ||
        node.type === 'image' ||
        node.type === 'link') &&
      node.url.startsWith(RELATIVE_PREFIX)
    ) {
      const offset = urlOffset(readme, node)
      if (offset !== undefined) {
        insertAt.push(offset)
      }
    } else if (node.type === 'html') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        for (const offset of htmlAttributeValueOffsets(
          readme.slice(start, end),
          (name, value) =>
            PINNED_ATTRS.has(name) && value.startsWith(RELATIVE_PREFIX),
        )) {
          insertAt.push(start + offset)
        }
      }
    }
  }
  return insertAtOffsets(readme, insertAt, baseUrl)
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
