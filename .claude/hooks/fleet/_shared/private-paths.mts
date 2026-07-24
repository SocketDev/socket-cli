/*
 * @file Shared detector for INTERNAL / PRIVATE path references that must never
 *   land in committed SOURCE-CODE comments. The incident that motivated it: an
 *   agent leaked a plans-directory path into a public
 *   napi-rs source file's comment. Public-surface-hygiene adjacent — pairs with
 *   `private-name-nudge` / `public-surface-nudge` / the no-cross-repo-relative
 *   path rule. See docs/agents.md/fleet/public-surface-hygiene.md.
 *
 *   Used by the `no-private-path-in-source-guard` hook. The same pattern set is
 *   mirrored (NOT imported — separate bundle trees) by the
 *   `socket/no-private-path-in-source` lint rule and the
 *   `scripts/fleet/check/private-paths-are-absent.mts` commit-time check.
 *
 *   The matchers are pure + side-effect free so they unit-test cleanly. Fail
 *   open is the caller's job (a hook never throws).
 */

export interface PrivatePathFinding {
  /**
   * Which class of private reference matched.
   */
  readonly kind:
    | 'claude-plans-reports'
    | 'cross-repo-claude'
    | 'home-abs-path'
    | 'sibling-repo-rel'
  /**
   * 1-based line number within the scanned text.
   */
  readonly line: number
  /**
   * The trimmed source line that matched.
   */
  readonly snippet: string
  /**
   * The exact substring that triggered the match.
   */
  readonly match: string
}

// Patterns, in priority order. Each carries its finding `kind`. They match the
// PATH TOKEN itself (not anchored on a comment marker) — the callers feed only
// comment-body text so a path inside a string literal or real source never
// reaches these.
//
// A path may legitimately appear in a doc / markdown / .claude file; these
// patterns are only consulted against SOURCE-CODE comment bodies, which is the
// caller's scope decision.
export const PRIVATE_PATH_PATTERNS: ReadonlyArray<{
  readonly kind: PrivatePathFinding['kind']
  readonly re: RegExp
}> = [
  {
    // A `.claude/plans/` or `.claude/reports/` segment anywhere — untracked,
    // operator-local working notes that must never be referenced from source.
    kind: 'claude-plans-reports',
    re: /(?:^|[\s"'`([{<])\.?\/?\.claude\/(?:plans|reports)\/[^\s"'`)\]}>]+/i,
  },
  {
    // A `socket-<repo>/.claude/...` cross-repo reference: a sibling fleet repo
    // name followed by its private `.claude/` tree. Discloses internal repo
    // layout when it lands in a public source file.
    kind: 'cross-repo-claude',
    re: /(?:^|[\s"'`([{<])socket-[a-z0-9][a-z0-9-]*\/\.claude\/[^\s"'`)\]}>]*/i,
  },
  {
    // An absolute `/Users/<user>/...` home path — a developer's local checkout
    // path, which leaks both the username and the on-disk layout.
    kind: 'home-abs-path',
    re: /(?:^|[\s"'`([{<])\/Users\/[^/\s"'`)\]}>]+\/[^\s"'`)\]}>]*/,
  },
  {
    // A `../socket-<repo>/` sibling fleet-repo relative path. Cross-repo
    // references presume a shared parent dir that only exists on a dev box. A
    // bare `../lib/` / `../http-request/` is an IN-repo relative import (a
    // sibling source dir), not a sibling REPO — only `../socket-<repo>/`
    // (another fleet checkout) is the leak the no-cross-repo-relative-paths rule
    // names, so the `socket-` segment prefix is required.
    kind: 'sibling-repo-rel',
    re: /(?:^|[\s"'`([{<])\.\.\/socket-[a-z0-9][a-z0-9-]*\/[^\s"'`)\]}>]*/i,
  },
]

/**
 * Scan a single comment-body line for the first private-path pattern it
 * contains. Returns the finding (minus the line number, which the caller
 * supplies) or undefined when the line is clean.
 */
export function matchPrivatePath(
  body: string,
): Omit<PrivatePathFinding, 'line' | 'snippet'> | undefined {
  for (let i = 0, { length } = PRIVATE_PATH_PATTERNS; i < length; i += 1) {
    const { kind, re } = PRIVATE_PATH_PATTERNS[i]!
    const m = re.exec(body)
    if (m) {
      // Strip the leading delimiter the pattern allowed (whitespace / quote /
      // bracket) so `match` is just the path token.
      const match = m[0].replace(/^[\s"'`([{<]/, '')
      return { __proto__: null, kind, match } as Omit<
        PrivatePathFinding,
        'line' | 'snippet'
      >
    }
  }
  return undefined
}

/**
 * Human-readable label for a finding kind, used in the block / report message.
 */
export function describePrivatePathKind(
  kind: PrivatePathFinding['kind'],
): string {
  switch (kind) {
    case 'claude-plans-reports':
      return 'an untracked .claude/plans|reports path (operator-local working notes)'
    case 'cross-repo-claude':
      return "another fleet repo's private .claude/ tree (cross-repo internal layout)"
    case 'home-abs-path':
      return 'an absolute /Users/<user>/ home path (leaks username + local layout)'
    /* c8 ignore start - 'sibling-repo-rel' is the final arm; the union is exhaustive so the default never runs */
    case 'sibling-repo-rel':
      return 'a ../socket-<repo>/ sibling fleet-repo relative path (presumes a dev-box layout)'
    default:
      return 'a private/internal path'
    /* c8 ignore stop */
  }
}

/**
 * Scan raw comment-BODY lines (no comment markers) for private paths, one
 * finding per matching line. `bodyLines` is the comment text already split into
 * lines by the caller (which owns marker stripping for its language).
 */
export function scanCommentBodyLines(
  bodyLines: readonly string[],
  startLine: number,
): PrivatePathFinding[] {
  const findings: PrivatePathFinding[] = []
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const body = bodyLines[i]!
    const hit = matchPrivatePath(body)
    if (hit) {
      findings.push({
        __proto__: null,
        kind: hit.kind,
        line: startLine + i,
        snippet: body.trim(),
        match: hit.match,
      } as PrivatePathFinding)
    }
  }
  return findings
}

// Lexical comment markers for NON-JS source languages (Rust, Go, C, Python,
// shell, …). We only feed text that follows a comment marker, so a path inside
// a string literal is never reached. JS/TS callers use the acorn walker instead.
const BLOCK_OPEN_RE = /\/\*/
const BLOCK_CLOSE_RE = /\*\//
const LINE_COMMENT_RE = /(?:#|--|\/\/)\s?(.*)$/

/**
 * One extracted comment body, paired with its 1-based source line number. The
 * `body` is comment TEXT only (markers stripped) — feed it straight to
 * `matchPrivatePath`.
 */
export interface LexicalCommentBody {
  readonly body: string
  readonly line: number
}

/**
 * Extract the comment-body text from each line of a NON-JS source `text`,
 * tracking a C-style block-comment span. The single source of truth both the
 * `no-private-path-in-source-guard` hook and the
 * `scripts/fleet/check/private-paths-are-absent.mts` check use, so their
 * lexical scan can never drift.
 *
 * Handles, per line:
 *
 * - Inside an open block span — the whole line is comment body; `*\/` closes it.
 * - A `/*` … `*\/` block that OPENS AND CLOSES on one line — the text between the
 *   markers is scanned (this is the motivating-incident shape: a Rust `/*
 *   /Users/… *\/` one-liner; the old code dropped it).
 * - A `/*` that opens and does NOT close — scan the rest of the line, then enter
 *   block mode.
 * - A `//` / `#` / `--` line comment — scan the trailing body.
 */
export function extractLexicalCommentBodies(
  text: string,
): LexicalCommentBody[] {
  const out: LexicalCommentBody[] = []
  const lines = text.split('\n')
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const lineNum = i + 1
    if (inBlock) {
      out.push({
        __proto__: null,
        body: line,
        line: lineNum,
      } as LexicalCommentBody)
      if (BLOCK_CLOSE_RE.test(line)) {
        inBlock = false
      }
      continue
    }
    const blockOpen = line.search(BLOCK_OPEN_RE)
    if (blockOpen !== -1) {
      const afterOpen = line.slice(blockOpen + 2)
      const closeIdx = afterOpen.search(BLOCK_CLOSE_RE)
      if (closeIdx !== -1) {
        // Block opens AND closes on this line — scan only the text between the
        // `/*` and the `*\/`. Stays on the same line; no block state change.
        out.push({
          __proto__: null,
          body: afterOpen.slice(0, closeIdx),
          line: lineNum,
        } as LexicalCommentBody)
        continue
      }
      // Block opened and not closed — scan the rest of the line, then enter
      // block mode for subsequent lines.
      out.push({
        __proto__: null,
        body: afterOpen,
        line: lineNum,
      } as LexicalCommentBody)
      inBlock = true
      continue
    }
    const lineMatch = LINE_COMMENT_RE.exec(line)
    if (lineMatch) {
      out.push({
        __proto__: null,
        body: lineMatch[1]!,
        line: lineNum,
      } as LexicalCommentBody)
    }
  }
  return out
}
