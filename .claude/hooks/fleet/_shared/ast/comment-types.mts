/**
 * @file Comment types + the annotation classifier for the AST comment tooling.
 *   Split from `comments.mts` (which holds `walkComments`) to stay under the
 *   file-size cap. Import from the specific `../ast/*.mts` module.
 */

/**
 * Comment-kind enum modeled on oxc-project's `CommentKind`. Three variants
 * because downstream tools (formatters, code-mods) need to distinguish a
 * one-line `/* … *\/` from a multi-line one — preserving the latter on rewrites
 * matters more.
 *
 * `Hashbang` is a fleet extension on top of oxc's kinds: oxc treats `#!` as a
 * separate node type entirely (not a comment), but for fleet-hook purposes a
 * hashbang IS comment-shaped trivia that hooks may want to walk uniformly with
 * line/block comments.
 */
export type CommentKind =
  | 'Line'
  | 'SingleLineBlock'
  | 'MultiLineBlock'
  | 'Hashbang'

/**
 * Pre-classified comment content. Modeled on oxc's `CommentContent` — saves
 * every consumer a regex scan of every comment body to detect common annotation
 * shapes: JSDoc, esbuild legal-comment, `#__PURE__` annotations,
 * `@vite-ignore`, webpack magic comments, etc.
 *
 * `None` is the default for comments that don't match any annotation pattern.
 * Most code comments fall here.
 */
export type CommentContent =
  | 'None'
  | 'Legal' // /*! …*\/ or starts with /*! / //! or contains @license / @preserve
  | 'Jsdoc' // /** … *\/ — block opening with /**, not /***
  | 'JsdocLegal' // /** … @preserve / @license *\/
  | 'Pure' // /* #__PURE__ *\/
  | 'NoSideEffects' // /* #__NO_SIDE_EFFECTS__ *\/
  | 'Webpack' // /* webpackChunkName: "…" *\/ / /* webpack* *\/
  | 'Vite' // /* @vite-ignore *\/
  | 'CoverageIgnore' // /* v8 ignore *\/ / /* c8 ignore *\/ / /* node:coverage *\/ / /* istanbul ignore *\/
  | 'Turbopack' // /* turbopack* *\/

/**
 * Where the comment sits relative to the nearest token.
 *
 * `Leading` — comment precedes a token. JSDoc on a function, comments
 * documenting the next statement, etc.
 *
 * `Trailing` — comment follows a token on the same source line. `// trailing`
 * style.
 *
 * Tools that auto-attach explanations to declarations (formatter,
 * doc-extractor) read this. Hooks that just grade comment bodies usually don't
 * need it.
 */
export type CommentPosition = 'Leading' | 'Trailing'

/**
 * Bitflag-style record of newlines around a comment. Encoded as a flat object
 * rather than a numeric bitflag to stay idiomatic in JS — every consumer just
 * reads booleans.
 */
export interface CommentNewlines {
  /**
   * True if a newline appears before the opening marker.
   */
  before: boolean
  /**
   * True if a newline appears after the closing marker (or end-of-line for
   * `Line`).
   */
  after: boolean
}

/**
 * One comment in the source. Modeled on oxc-project's `Comment`. Hooks filter
 * on `kind` + `content` to find relevant comments without re-scanning bodies.
 */
export interface CommentSite {
  /**
   * Line / SingleLineBlock / MultiLineBlock / Hashbang.
   */
  kind: CommentKind
  /**
   * Pre-classified annotation kind. `None` for ordinary comments.
   */
  content: CommentContent
  /**
   * Position relative to the nearest token.
   */
  position: CommentPosition
  /**
   * Newlines before / after the comment.
   */
  newlines: CommentNewlines
  /**
   * Byte offset of the start of the comment (including marker).
   */
  start: number
  /**
   * Byte offset of the end of the comment (after closing marker).
   */
  end: number
  /**
   * Byte offset of the next non-trivia token after a leading comment. `-1` when
   * the comment is trailing or has no following token. Mirrors oxc's
   * `attached_to`. Hooks that want to associate a comment with the symbol it
   * documents read this.
   */
  attachedTo: number
  /**
   * Raw comment body (text between markers, no marker chars).
   */
  value: string
  /**
   * 1-based line of the opening marker.
   */
  line: number
  /**
   * Trimmed source line containing the comment opening.
   */
  text: string
}

/**
 * Pre-classify a comment body into a `CommentContent` annotation variant.
 * Modeled on oxc's classifier — same set of categories, same priority order.
 * Fleet hooks consume the `content` field rather than re-running these regexes
 * on every comment.
 *
 * The marker char passed in distinguishes `/*!` (Legal) from `/**` (Jsdoc)
 * since both look the same to a body-only scan.
 */
export function classifyCommentContent(
  kind: CommentKind,
  fullText: string,
  body: string,
): CommentContent {
  // `Hashbang` and `Line` comments don't carry block-only annotations.
  // We still classify `Line` against the Pure / NoSideEffects / coverage
  // markers because some tools (uglify, terser) accept them in line form.
  const trimmedBody = body.trim()

  // Block-style annotations — only relevant when this is a block.
  if (kind === 'MultiLineBlock' || kind === 'SingleLineBlock') {
    // Legal: `/*!` opener OR contains `@license` / `@preserve`.
    const isLegalMarker = fullText.startsWith('/*!')
    // socket-lint: allow uncommented-regex -- @license / @preserve annotation.
    const hasLegalAnnotation = /@(?:license|preserve)\b/.test(body)
    // Jsdoc: `/**` opener (but NOT `/***`).
    const isJsdoc = fullText.startsWith('/**') && !fullText.startsWith('/***')

    if (isJsdoc && hasLegalAnnotation) {
      return 'JsdocLegal'
    }
    if (isJsdoc) {
      return 'Jsdoc'
    }
    if (isLegalMarker || hasLegalAnnotation) {
      return 'Legal'
    }
    // socket-lint: allow uncommented-regex -- #__PURE__ annotation, trimmed body.
    if (/^\s*#__PURE__\s*$/.test(trimmedBody)) {
      return 'Pure'
    }
    // socket-lint: allow uncommented-regex -- #__NO_SIDE_EFFECTS__ annotation.
    if (/^\s*#__NO_SIDE_EFFECTS__\s*$/.test(trimmedBody)) {
      return 'NoSideEffects'
    }
    // socket-lint: allow uncommented-regex -- @vite-ignore magic comment.
    if (/@vite-ignore\b/.test(body)) {
      return 'Vite'
    }
    // socket-lint: allow uncommented-regex -- webpackXxx: magic comment.
    if (/\bwebpack[A-Z]\w*\s*:/.test(body)) {
      return 'Webpack'
    }
    // socket-lint: allow uncommented-regex -- turbopackXxx: magic comment.
    if (/\bturbopack[A-Z]\w*\s*:/.test(body)) {
      return 'Turbopack'
    }
  }

  // Coverage-ignore markers can appear in `Line` form too.
  if (
    // The four coverage-ignore markers (sorted): `c8 ignore`, `istanbul
    // ignore`, `node:coverage`, `v8 ignore` — each with flexible inner spacing.
    /\b(?:c8\s+ignore|istanbul\s+ignore|node:coverage|v8\s+ignore)\b/.test(body)
  ) {
    return 'CoverageIgnore'
  }

  // `//!` opener — terser/uglify treat this as a legal line comment.
  if (kind === 'Line' && fullText.startsWith('//!')) {
    return 'Legal'
  }

  return 'None'
}
