/**
 * @file Shared derivation of the lockstep-mirror format-skip set — the ONE
 *   place the `.config/fleet/.prettierignore` `lockstep-mirrors` block is
 *   computed from the manifest, used by both the deriver
 *   (`emit-mirror-globs.mts`, which WRITES the block) and the validator
 *   (`check/lockstep-mirror-markers-are-declared.mts`, which ASSERTS the block
 *   matches). A verbatim upstream mirror is declared by a `file-fork` row with
 *   `mirror: true`; its `local` path becomes one `**`-anchored glob so oxfmt
 *   skips it (it is kept byte-identical with upstream, so our formatter must
 *   not touch it). Because the block is manifest-derived and asserted, the
 *   format-skip set can never grow past the declared mirrors — it is NOT a
 *   blanket ignore of the whole `conformance/shims` dir (that dir also holds
 *   non-verbatim adapter shims that SHOULD be fleet-formatted).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { loadManifestTree } from './manifest.mts'
import type { FileForkRow } from './schema.mts'

// Fenced block sentinels in .config/fleet/.prettierignore. The block is
// machine-owned; hand edits are overwritten by emit-mirror-globs.mts and
// rejected by lockstep-mirror-markers-are-declared.mts.
export const LOCKSTEP_MIRRORS_BEGIN = '# BEGIN lockstep-mirrors (generated)'
export const LOCKSTEP_MIRRORS_END = '# END lockstep-mirrors (generated)'

export interface DeclaredMirror {
  readonly id: string
  readonly local: string
  readonly upstreamPath: string
  readonly sha: string
}

/**
 * Every `file-fork` row flagged `mirror: true` across the manifest tree, in
 * manifest order. A deviating fork (mouse-parser, etc.) stays `mirror: false`
 * and is intentionally excluded — only genuine verbatim mirrors qualify.
 */
export function collectDeclaredMirrors(
  rootManifestPath: string,
): DeclaredMirror[] {
  const { merged } = loadManifestTree(rootManifestPath)
  const mirrors: DeclaredMirror[] = []
  for (let i = 0, { length } = merged.rows; i < length; i += 1) {
    const row = merged.rows[i]!
    if (row.kind !== 'file-fork') {
      continue
    }
    const fork = row as FileForkRow
    if (fork.mirror !== true) {
      continue
    }
    mirrors.push({
      id: fork.id,
      local: fork.local,
      upstreamPath: fork.upstream_path,
      sha: fork.forked_at_sha,
    })
  }
  return mirrors
}

/**
 * The `**`-anchored .prettierignore glob for a mirror's repo-relative `local`
 * path. `**`-anchored per prettierignore-globs-are-anchored.mts so it matches
 * at any depth through the ignore file rooted at `.config/fleet/`.
 */
export function mirrorGlob(local: string): string {
  const norm = normalizePath(local).replace(/^\.?\/+/, '')
  return `**/${norm}`
}

/**
 * The sorted, de-duplicated `**`-anchored globs for a set of declared mirrors.
 * Sorted so the emitted block is stable regardless of manifest row order.
 */
export function derivedMirrorGlobs(
  mirrors: readonly DeclaredMirror[],
): string[] {
  const globs = new Set<string>()
  for (let i = 0, { length } = mirrors; i < length; i += 1) {
    globs.add(mirrorGlob(mirrors[i]!.local))
  }
  return [...globs].toSorted()
}

/**
 * The glob lines currently inside the fenced block, or undefined when the file
 * has no block. Blank lines and interior comments are dropped so only the
 * active globs are compared.
 */
export function extractMirrorBlock(content: string): string[] | undefined {
  const lines = content.split('\n')
  const beginIdx = lines.findIndex(l => l.trim() === LOCKSTEP_MIRRORS_BEGIN)
  const endIdx = lines.findIndex(l => l.trim() === LOCKSTEP_MIRRORS_END)
  if (beginIdx === -1 || endIdx <= beginIdx) {
    return undefined
  }
  const globs: string[] = []
  for (let i = beginIdx + 1; i < endIdx; i += 1) {
    const trimmed = lines[i]!.trim()
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      globs.push(trimmed)
    }
  }
  return globs
}

/**
 * The full fenced block text (header comment + sentinels + globs) for a set of
 * derived globs. An empty mirror set still emits the block so the deriver and
 * check agree on its presence.
 */
export function renderMirrorBlock(globs: readonly string[]): string {
  const header = [
    '# Lockstep verbatim upstream mirrors — files kept byte-identical with the',
    '# upstream source they mirror, declared `mirror: true` in the lockstep',
    '# manifest and carrying the `// @lockstep-mirror` header marker. DERIVED by',
    '# scripts/fleet/lockstep/emit-mirror-globs.mts and asserted by',
    '# scripts/fleet/check/lockstep-mirror-markers-are-declared.mts — never hand-edit.',
    LOCKSTEP_MIRRORS_BEGIN,
  ]
  return [...header, ...globs, LOCKSTEP_MIRRORS_END].join('\n')
}

/**
 * Replace the existing fenced block in `content` with a freshly rendered one.
 * When no block exists, append it (preceded by a blank line) so the deriver is
 * idempotent on a first run.
 */
export function spliceMirrorBlock(
  content: string,
  globs: readonly string[],
): string {
  const lines = content.split('\n')
  const beginIdx = lines.findIndex(l => l.trim() === LOCKSTEP_MIRRORS_BEGIN)
  const block = renderMirrorBlock(globs)
  if (beginIdx === -1) {
    const trimmed = content.replace(/\n+$/, '')
    return `${trimmed}\n\n${block}\n`
  }
  // Splice from the header comment (first line of the header) through END. The
  // header's first line is 5 lines above BEGIN.
  const headerStart = Math.max(0, beginIdx - 5)
  const endIdx = lines.findIndex(l => l.trim() === LOCKSTEP_MIRRORS_END)
  const before = lines.slice(0, headerStart).join('\n').replace(/\n+$/, '')
  const after = lines
    .slice(endIdx + 1)
    .join('\n')
    .replace(/^\n+/, '')
  const rebuilt = `${before}\n\n${block}`
  return after ? `${rebuilt}\n${after}` : `${rebuilt}\n`
}
