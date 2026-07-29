/*
 * @file Shared matchers for the durable memory store — the auto-memory tree at
 *   `~/.claude/projects/<slug>/memory/*.md`.
 *
 *   Three surfaces read the same two facts (is this path a memory entry, does
 *   its frontmatter carry an `enforcement:` stamp), so both matchers live here
 *   once:
 *
 *   - `memory-enforcement-stamp-guard` (PreToolUse) blocks a memory write whose
 *     frontmatter carries no `enforcement:` key at all — a mechanical,
 *     write-time invariant.
 *   - `uncodified-lesson-nudge` (Stop) judges whether a memory with an
 *     enforceable always/never/MUST shape cites a REAL enforcer — a
 *     non-blocking judgment call, deliberately a separate surface.
 *   - `scripts/fleet/check/memories-are-codified.mts` is the commit-time belt
 *     scan over the whole store.
 */

// Memory-store entry, separator-normalized:
// …/.claude/projects/<slug>/memory/<file>.md
// require-regex-comment: the auto-memory store path shape.
const MEMORY_PATH_RE = /\/\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$/

// The store's index file, which carries no frontmatter and states no rule.
// require-regex-comment: the memory store's index filename.
const MEMORY_INDEX_RE = /\/MEMORY\.md$/i

/**
 * True when `filePath` names a file inside a memory store, index included.
 */
export function isMemoryStorePath(filePath: string): boolean {
  return MEMORY_PATH_RE.test(filePath.replaceAll('\\', '/'))
}

/**
 * True when `filePath` is the store's `MEMORY.md` index rather than an entry.
 */
export function isMemoryIndexPath(filePath: string): boolean {
  return MEMORY_INDEX_RE.test(filePath.replaceAll('\\', '/'))
}

/**
 * True when `filePath` is a memory ENTRY — a store file that is not the index.
 */
export function isMemoryEntryPath(filePath: string): boolean {
  return isMemoryStorePath(filePath) && !isMemoryIndexPath(filePath)
}

/**
 * True when the content's frontmatter carries a non-empty `enforcement:` line,
 * top-level or nested under `metadata:`.
 *
 * The value must sit on the SAME line as the key: `\s` matches newlines too, so
 * a naive `\s*\S+` reads straight through an EMPTY `enforcement:` line into
 * whatever non-whitespace starts the next line (the closing `---` fence, or the
 * next key) and reports it as stamped. `[ \t]*` restricts the gap to horizontal
 * whitespace, so an empty stamp correctly reads as missing.
 */
export function hasEnforcementStamp(content: string): boolean {
  return /^[ \t]*enforcement:[ \t]*\S+/m.test(content)
}

/**
 * The `type:` declared in a memory's frontmatter (top-level or under
 * `metadata:`), or undefined. Same same-line restriction as
 * `hasEnforcementStamp`.
 */
export function memoryFrontmatterType(content: string): string | undefined {
  const match = content.match(/^[ \t]*type:[ \t]*([A-Za-z]+)/m)
  return match?.[1]
}
