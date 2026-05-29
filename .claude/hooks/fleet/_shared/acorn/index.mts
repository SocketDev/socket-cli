/**
 * @file Shared acorn-wasm wrapper for fleet hooks. Vendored from
 *   socket-lib/vendor/acorn pending the `@ultrathink/acorn` npm publish; once
 *   that lands, fleet hooks switch to the published package and this directory
 *   can be retired. Surface kept narrow: `parse(source, opts)` for raw AST +
 *   `simple(source, visitors, opts)` for visitor-based walks. Higher-level
 *   shape detectors (`findCallsTo`, `findBareCallsTo`) cover the common "lint a
 *   specific identifier call" pattern that hooks need.
 */

import { parse as wasmParse, simple as wasmSimple } from './acorn-sync.mts'

export interface AcornNode {
  type: string
  start: number
  end: number
  // Index signature lets hooks read whatever the node type exposes.
  [key: string]: unknown
}

export interface ParseOptions {
  /**
   * ECMAScript version. Default 2026 — matches the fleet's Node 26 floor.
   */
  ecmaVersion?: number | undefined
  /**
   * `module` (default) or `script`. Hooks should leave this alone unless
   * inspecting CJS source where top-level `await` would surprise them.
   */
  sourceType?: 'module' | 'script' | undefined
  /**
   * Allow TypeScript syntax (type annotations, generics, satisfies, etc.).
   * Default `true` because every fleet hook file is `.ts` / `.mts` / `.cts`.
   * Set to `false` only when you genuinely need strict JS-only parsing.
   */
  typescript?: boolean | undefined
  /**
   * Allow JSX. Default `false` — hooks rarely parse JSX. Pure-JSX detectors set
   * this `true`.
   */
  jsx?: boolean | undefined
  /**
   * Collect comments. Default `false` — most hooks don't inspect comments and
   * pay zero scanner cost when this is off.
   *
   * When `true`, `walkComments(source, { comments: true })` returns the
   * populated `CommentSite[]`. Modeled on oxc-project's collection-on-demand
   * model.
   */
  comments?: boolean | undefined
}

const DEFAULT_PARSE_OPTIONS: Required<ParseOptions> = {
  ecmaVersion: 2026,
  sourceType: 'module',
  typescript: true,
  jsx: false,
  comments: false,
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
    if (/^\s*#__PURE__\s*$/.test(trimmedBody)) {
      return 'Pure'
    }
    if (/^\s*#__NO_SIDE_EFFECTS__\s*$/.test(trimmedBody)) {
      return 'NoSideEffects'
    }
    if (/@vite-ignore\b/.test(body)) {
      return 'Vite'
    }
    if (/\bwebpack[A-Z]\w*\s*:/.test(body)) {
      return 'Webpack'
    }
    if (/\bturbopack[A-Z]\w*\s*:/.test(body)) {
      return 'Turbopack'
    }
  }

  // Coverage-ignore markers can appear in `Line` form too.
  if (
    /\b(?:v8\s+ignore|c8\s+ignore|node:coverage|istanbul\s+ignore)\b/.test(body)
  ) {
    return 'CoverageIgnore'
  }

  // `//!` opener — terser/uglify treat this as a legal line comment.
  if (kind === 'Line' && fullText.startsWith('//!')) {
    return 'Legal'
  }

  return 'None'
}

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
 * Wire-shape of a single Comment record on the AST root, emitted by the
 * vendored Rust acorn-wasm when `parse(source, { collectComments: true })` is
 * set. Mirrors oxc's program.comments. `walkComments` translates this into
 * `CommentSite` (which adds the legacy `line` / `text` / `value` fields).
 */
interface ParsedComment {
  start: number
  end: number
  attachedTo: number | null
  kind: CommentKind
  content: CommentContent
  position: CommentPosition
  newlineBefore: boolean
  newlineAfter: boolean
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
 * Legacy convenience: `'Line' | 'Block' | 'Hashbang'` collapse used by older
 * callers. Maps `SingleLineBlock` and `MultiLineBlock` to `Block`. New code
 * should read `c.kind` directly so the single-vs-multi distinction is
 * preserved.
 *
 * @deprecated Read `c.kind` directly. Will be removed once all hooks
 *   are migrated.
 */
export function commentTypeCompat(
  kind: CommentKind,
): 'Line' | 'Block' | 'Hashbang' {
  if (kind === 'MultiLineBlock' || kind === 'SingleLineBlock') {
    return 'Block'
  }
  return kind
}

/**
 * Find every BARE call to the named identifier in `source`. "Bare" means the
 * callee is an `Identifier` node (not a `MemberExpression`) — so
 * `structuredClone(x)` matches but `obj.structuredClone(x)` does not. Hook
 * callers use this to flag a specific global-function call without
 * false-positives on member-call methods that happen to share the name.
 *
 * Skips calls whose immediately-preceding line contains `//
 * oxlint-disable-next-line <ruleName>` (matching the lint rule's per-line
 * opt-out shape). The marker comes through as plain text in the source, so we
 * re-scan around each match for it.
 *
 * Returns an empty array on parse failure (fragment tolerance).
 */
export function findBareCallsTo(
  source: string,
  identifierName: string,
  options?:
    | (ParseOptions & {
        /**
         * Optional lint-rule name. When provided, calls whose preceding line
         * contains `oxlint-disable-next-line <ruleName>` are filtered out.
         */
        oxlintRuleName?: string | undefined
      })
    | undefined,
): CallSite[] {
  const matches: CallSite[] = []
  const lines = splitLines(source)
  const disableMarker = options?.oxlintRuleName
    ? `oxlint-disable-next-line ${options.oxlintRuleName}`
    : undefined

  walkSimple(
    source,
    {
      CallExpression(node) {
        const callee = node['callee'] as AcornNode | undefined
        if (!callee || callee.type !== 'Identifier') {
          return
        }
        if ((callee['name'] as string) !== identifierName) {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        if (disableMarker && line >= 2) {
          const prev = lines[line - 2] ?? ''
          if (prev.includes(disableMarker)) {
            return
          }
        }
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
        })
      },
    },
    options,
  )
  return matches
}

export interface MemberCallSite extends CallSite {
  /**
   * First-argument source text if a string literal, else undefined.
   */
  firstStringArg: string | undefined
  /**
   * Number of arguments (positional + spreads).
   */
  argCount: number
  /**
   * True when every argument is a string Literal (callers use this for
   * "all-literal call site" detection like path.join('a', 'b', 'c')).
   */
  allStringLiteralArgs: boolean
}

/**
 * Find every `<object>.<property>(...)` member-call in `source`. Used by hooks
 * that want to flag specific known APIs (`console.log`, `path.join`,
 * `process.stdout.write`, etc.) without false-positives on string literals or
 * comments that happen to mention the same dotted name.
 *
 * `object` and `property` are matched exactly. To match `process.stdout.write`
 * (a 3-segment member expression), pass `object: 'process.stdout'` — the helper
 * accepts dotted object paths and walks the nested `MemberExpression`s to
 * confirm the chain.
 */
export function findMemberCalls(
  source: string,
  object: string,
  property: string,
  options?: ParseOptions | undefined,
): MemberCallSite[] {
  const matches: MemberCallSite[] = []
  const lines = splitLines(source)
  const objectChain = object.split('.')

  function calleeMatches(callee: AcornNode | undefined): boolean {
    if (!callee || callee.type !== 'MemberExpression') {
      return false
    }
    const prop = callee['property'] as AcornNode | undefined
    if (
      !prop ||
      prop.type !== 'Identifier' ||
      (prop['name'] as string) !== property
    ) {
      return false
    }
    let head: AcornNode | undefined = callee['object'] as AcornNode | undefined
    // Walk the dotted chain right-to-left. For object='process.stdout',
    // we expect head to be MemberExpression{object: process, property: stdout}.
    for (let i = objectChain.length - 1; i >= 0; i -= 1) {
      const segment = objectChain[i]!
      if (i === 0) {
        // Leftmost segment must be an Identifier.
        if (!head || head.type !== 'Identifier') {
          return false
        }
        return (head['name'] as string) === segment
      }
      // Inner segments are MemberExpression{property: segment}.
      if (!head || head.type !== 'MemberExpression') {
        return false
      }
      const innerProp = head['property'] as AcornNode | undefined
      if (
        !innerProp ||
        innerProp.type !== 'Identifier' ||
        (innerProp['name'] as string) !== segment
      ) {
        return false
      }
      head = head['object'] as AcornNode | undefined
    }
    return true
  }

  walkSimple(
    source,
    {
      CallExpression(node) {
        if (!calleeMatches(node['callee'] as AcornNode | undefined)) {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const args = (node['arguments'] as AcornNode[] | undefined) ?? []
        let firstStringArg: string | undefined
        let allStringLiteralArgs = args.length > 0
        for (let i = 0; i < args.length; i += 1) {
          const arg = args[i]!
          const isStringLit =
            arg.type === 'Literal' && typeof arg['value'] === 'string'
          if (!isStringLit) {
            allStringLiteralArgs = false
          }
          if (i === 0 && isStringLit) {
            firstStringArg = arg['value'] as string
          }
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          firstStringArg,
          argCount: args.length,
          allStringLiteralArgs,
        })
      },
    },
    options,
  )
  return matches
}

export interface RegexLiteralSite extends CallSite {
  /**
   * The regex pattern source (without surrounding `/`).
   */
  pattern: string
  /**
   * The flags string (`g`, `i`, `m`, etc.).
   */
  flags: string
}

/**
 * Find every regex literal (`/pattern/flags`) in `source`. Used by the
 * path-regex-normalize-reminder rule to flag patterns that try to match both
 * path separators inline (`[/\\]`, `[\\\\/]`). Pure regex literals only;
 * doesn't reach into `new RegExp('…')` constructor calls.
 *
 * AST shape: `Literal { regex: { pattern, flags }, value: RegExp }`.
 */
export function findRegexLiterals(
  source: string,
  options?: ParseOptions | undefined,
): RegexLiteralSite[] {
  const matches: RegexLiteralSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      Literal(node) {
        const regex = node['regex'] as
          | { pattern: string; flags: string }
          | undefined
        if (!regex || typeof regex.pattern !== 'string') {
          return
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          pattern: regex.pattern,
          flags: regex.flags ?? '',
        })
      },
    },
    options,
  )
  return matches
}

export interface TemplateLiteralSite extends CallSite {
  /**
   * The concatenated quasi (static text) segments of the template, with `${…}`
   * expression slots replaced by a single `\0` NUL byte sentinel. Callers split
   * this on `/`, `.`, etc. to inspect path segments without mistaking
   * interpolated content for a segment.
   *
   * Example: a backtick template with two expression slots and three static
   * parts yields a string with two `\0` sentinels separating those parts.
   */
  segments: string
  /**
   * Number of `${…}` expressions in the template.
   */
  expressionCount: number
}

/**
 * Find every template literal in `source`. Used by hooks that detect
 * multi-segment patterns encoded in backtick strings. Returns the concatenated
 * quasi text with expression slots marked by `\0` so callers can split on path
 * separators without false-positives on interpolated content.
 *
 * Tagged templates (`html`-tagged etc.) are skipped — the tag fundamentally
 * changes the meaning; only bare template literals participate.
 */
export function findTemplateLiterals(
  source: string,
  options?: ParseOptions | undefined,
): TemplateLiteralSite[] {
  const matches: TemplateLiteralSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      TemplateLiteral(node) {
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        // Look backward through whitespace for a tag prefix
        // (Identifier / `)` / `]`). If found, this is a tagged
        // template; the tag changes semantics so we skip.
        let i = start - 1
        while (i >= 0 && /\s/.test(source[i]!)) {
          i -= 1
        }
        if (i >= 0 && /[\w$)\]]/.test(source[i]!)) {
          return
        }
        const quasis = (node['quasis'] as AcornNode[] | undefined) ?? []
        const parts: string[] = []
        for (let qi = 0; qi < quasis.length; qi += 1) {
          const q = quasis[qi]!
          const value = q['value'] as
            | { raw?: string | undefined; cooked?: string | undefined }
            | undefined
          const cooked = value?.cooked ?? value?.raw ?? ''
          parts.push(cooked)
          if (qi < quasis.length - 1) {
            parts.push('\0')
          }
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          segments: parts.join(''),
          expressionCount: Math.max(0, quasis.length - 1),
        })
      },
    },
    options,
  )
  return matches
}

export interface ThrowSite extends CallSite {
  /**
   * The constructor name used in `throw new <ctor>(…)`.
   */
  ctorName: string
  /**
   * First-argument source text if a string literal, else undefined.
   */
  message: string | undefined
}

/**
 * Find every `throw new <ctor>(…)` expression in `source`. Used by the
 * error-message-quality rule to inspect the message string of thrown errors.
 * `ctor` semantics:
 *
 * - `undefined` — match every constructor (custom error classes too).
 * - `string` — exact-match `NewExpression.callee.name`.
 * - `RegExp` — match the callee name against the regex. Use this to catch
 *   class-name patterns like `/Error$/` (every *Error class).
 */
export function findThrowNew(
  source: string,
  ctor: string | RegExp | undefined,
  options?: ParseOptions | undefined,
): ThrowSite[] {
  const matches: ThrowSite[] = []
  const lines = splitLines(source)

  walkSimple(
    source,
    {
      ThrowStatement(node) {
        const arg = node['argument'] as AcornNode | undefined
        if (!arg || arg.type !== 'NewExpression') {
          return
        }
        const callee = arg['callee'] as AcornNode | undefined
        if (!callee || callee.type !== 'Identifier') {
          return
        }
        const calleeName = callee['name'] as string
        if (ctor !== undefined) {
          if (typeof ctor === 'string') {
            if (calleeName !== ctor) {
              return
            }
          } else if (!ctor.test(calleeName)) {
            return
          }
        }
        const args = (arg['arguments'] as AcornNode[] | undefined) ?? []
        let message: string | undefined
        const first = args[0]
        if (
          first &&
          first.type === 'Literal' &&
          typeof first['value'] === 'string'
        ) {
          message = first['value'] as string
        }
        const start = node['start'] as number | undefined
        if (typeof start !== 'number') {
          return
        }
        const { line, column } = offsetToLineCol(source, start)
        matches.push({
          line,
          column,
          text: (lines[line - 1] ?? '').trim(),
          ctorName: calleeName,
          message,
        })
      },
    },
    options,
  )
  return matches
}

/**
 * Convert a byte offset into 1-based line + 0-based column. The wasm parser
 * doesn't emit `loc` data even with `locations: true`, but every node carries
 * `start` / `end` byte offsets — this function bridges the gap.
 *
 * Counts `\n`, `\r`, AND `\r\n` (treated as one newline) so the line number
 * agrees with `splitLines(source)[line - 1]` regardless of the source's newline
 * convention.
 */
export function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < source.length; i += 1) {
    const code = source.charCodeAt(i)
    if (code === 13 /* \r */) {
      line += 1
      // `\r\n` counts as one newline — skip the `\n` if present.
      if (source.charCodeAt(i + 1) === 10) {
        i += 1
      }
      lineStart = i + 1
    } else if (code === 10 /* \n */) {
      line += 1
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart }
}

export interface CallSite {
  /**
   * 1-based line number of the call.
   */
  line: number
  /**
   * 0-based column of the call.
   */
  column: number
  /**
   * Source snippet of the line containing the call (best-effort).
   */
  text: string
}

/**
 * Split source text into lines while normalizing the three legal newline
 * conventions: `\r\n` (Windows), `\n` (Unix), `\r` (legacy Mac). Hooks that
 * inspect source line-by-line should ALWAYS go through this helper — a raw
 * `source.split('\n')` over a CRLF file leaves a trailing `\r` on every line,
 * breaking line-snippet display and regex anchors.
 *
 * Returns one entry per logical line. A trailing newline produces an empty
 * trailing entry, matching `split('\n')` semantics.
 */
export function splitLines(source: string): string[] {
  // Single regex pass: collapse `\r\n` and bare `\r` to `\n`, then split.
  return source.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Parse a JS/TS source string into an acorn AST. Returns `undefined` on parse
 * failure — hooks see incomplete fragments (Edit's `new_string` is a snippet,
 * not a whole file) and shouldn't crash on syntax error.
 */
export function tryParse(
  source: string,
  options?: ParseOptions | undefined,
): AcornNode | undefined {
  try {
    return wasmParse(source, {
      __proto__: null,
      ...DEFAULT_PARSE_OPTIONS,
      ...options,
    } as unknown as ParseOptions) as AcornNode
  } catch {
    return undefined
  }
}

/**
 * Walk every comment token in `source`. Hooks that grade or filter comments
 * (no-meta-comments, pointer-comment, comment-tone) use this so they don't
 * false-positive on comment-looking content inside string literals or template
 * strings.
 *
 * Each `CommentSite` carries oxc-shape metadata: `kind` (Line / SingleLineBlock
 * / MultiLineBlock / Hashbang), `content` (pre- classified annotation),
 * `position` (Leading / Trailing), `newlines`, and `attachedTo` (offset of the
 * next token for leading comments).
 *
 * Opt-in: comment collection is OFF by default. Pass `{ comments: true }` (or
 * set `parser.comments = true` in the future parser config). The default-off
 * shape matches oxc's "free at lex time but you have to ask for it" stance —
 * `walkComments` returns `[]` when off, with zero scanner cost.
 *
 * Implementation note: the vendored acorn-wasm doesn't currently expose an
 * `onComment` callback (the Rust lexer skips comments without collection — no
 * parser-level hook). This function uses a character-level scanner that's aware
 * of `'…'`, `"…"`, and `\`…`` to skip strings/templates correctly;
 * comment-looking text inside a string literal won't be reported.
 *
 * Limitations of the scanner vs a true parser-level callback:
 *
 * - Regex literals: `/foo \/\/ bar/` — the scanner doesn't disambiguate `/`
 *   start-of-regex from `/` division. Real-world: comments inside regex
 *   literals are rare and a regex containing `//` would be a
 *   line-comment-marker inside a slash-delimited region, which most patterns
 *   don't construct. Documented edge case.
 * - JSX: `{/* comment *\/}` inside JSX is handled (parses as block comment in the
 *   JS scanner pass).
 *
 * Returns the comments in source order. Empty array if source is empty.
 *
 * TODO (parser feature gap): land `onComment` in the ultrathink Rust parser,
 * sync to Go/C++/TypeScript ports, rebuild wasm. Then this function can switch
 * to the parser-level callback. The scanner stays as the fragment-tolerant
 * fallback when the parser rejects the input.
 */
export function walkComments(
  source: string,
  options?: ParseOptions | undefined,
): CommentSite[] {
  // Opt-in. Default is OFF — caller must explicitly enable with
  // `{ comments: true }`. Modeled on oxc's collection-on-demand.
  if (options?.comments !== true) {
    return []
  }
  // Fast path: parser-level collection. The vendored Rust acorn-wasm
  // now exposes Options.collectComments — when set, the AST root
  // carries a `comments` array of oxc-shape records ready-classified
  // (kind / content / position / attachedTo / newlineBefore+after).
  // We just need to bolt on the legacy `line` + `text` + `value` fields
  // that pre-date the parser support and that CommentSite still ships.
  try {
    const parsed = wasmParse(source, {
      __proto__: null,
      ...DEFAULT_PARSE_OPTIONS,
      ...options,
      collectComments: true,
    } as unknown as ParseOptions) as
      | (AcornNode & { comments?: ParsedComment[] | undefined })
      | undefined
    const parsedComments = parsed?.['comments']
    if (Array.isArray(parsedComments) && parsedComments.length >= 0) {
      const lines = splitLines(source)
      return parsedComments.map((pc): CommentSite => {
        const { line } = offsetToLineCol(source, pc.start)
        const fullText = source.slice(pc.start, pc.end)
        let value: string
        if (pc.kind === 'Line') {
          value = fullText.startsWith('//') ? fullText.slice(2) : fullText
        } else if (pc.kind === 'Hashbang') {
          value = fullText.startsWith('#!') ? fullText.slice(2) : fullText
        } else {
          // SingleLineBlock or MultiLineBlock.
          value =
            fullText.startsWith('/*') && fullText.endsWith('*/')
              ? fullText.slice(2, -2)
              : fullText
        }
        return {
          kind: pc.kind,
          content: pc.content,
          position: pc.position,
          newlines: {
            before: pc.newlineBefore,
            after: pc.newlineAfter,
          },
          start: pc.start,
          end: pc.end,
          attachedTo: pc.attachedTo == null ? -1 : pc.attachedTo,
          value,
          line,
          text: (lines[line - 1] ?? '').trim(),
        }
      })
    }
  } catch {
    // Parser rejected the input (fragment, syntax error, future-syntax
    // not yet supported). Fall through to the legacy scanner — it's
    // tolerant of incomplete inputs and is the documented escape hatch.
  }
  // Internal record shape during the scan. We fill in `position`,
  // `newlines`, `attachedTo`, and `content` in a second pass after
  // the full comment list is known.
  interface PendingComment {
    kind: CommentKind
    start: number
    end: number
    value: string
    fullText: string
    line: number
    text: string
  }
  const pending: PendingComment[] = []
  const lines = splitLines(source)
  const len = source.length
  let i = 0
  let stringQuote: string | undefined
  let templateDepth = 0
  // Hashbang: only valid at offset 0 per ES2023 grammar.
  if (
    len >= 2 &&
    source.charCodeAt(0) === 35 /* # */ &&
    source.charCodeAt(1) === 33 /* ! */
  ) {
    let j = 2
    while (j < len && source.charCodeAt(j) !== 10 /* \n */) {
      j += 1
    }
    pending.push({
      kind: 'Hashbang',
      start: 0,
      end: j,
      value: source.slice(2, j),
      fullText: source.slice(0, j),
      line: 1,
      text: (lines[0] ?? '').trim(),
    })
    i = j
  }
  while (i < len) {
    const c = source[i]!
    if (stringQuote !== undefined) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === stringQuote) {
        stringQuote = undefined
      }
      i += 1
      continue
    }
    if (templateDepth > 0) {
      if (c === '\\') {
        i += 2
        continue
      }
      // `${` opens an expression slot — drop out of template mode.
      if (c === '$' && source[i + 1] === '{') {
        templateDepth -= 1
        i += 2
        continue
      }
      if (c === '`') {
        templateDepth -= 1
      }
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      stringQuote = c
      i += 1
      continue
    }
    if (c === '`') {
      templateDepth += 1
      i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const start = i
      let j = i + 2
      while (j < len && source.charCodeAt(j) !== 10) {
        j += 1
      }
      const { line } = offsetToLineCol(source, start)
      pending.push({
        kind: 'Line',
        start,
        end: j,
        value: source.slice(start + 2, j),
        fullText: source.slice(start, j),
        line,
        text: (lines[line - 1] ?? '').trim(),
      })
      i = j
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i
      let j = i + 2
      while (j < len - 1) {
        if (source[j] === '*' && source[j + 1] === '/') {
          j += 2
          break
        }
        j += 1
      }
      const body = source.slice(start + 2, j - 2)
      // SingleLine vs MultiLine block — does the body contain a newline?
      const isMulti = body.includes('\n') || body.includes('\r')
      const kind: CommentKind = isMulti ? 'MultiLineBlock' : 'SingleLineBlock'
      const { line } = offsetToLineCol(source, start)
      pending.push({
        kind,
        start,
        end: j,
        value: body,
        fullText: source.slice(start, j),
        line,
        text: (lines[line - 1] ?? '').trim(),
      })
      i = j
      continue
    }
    i += 1
  }

  // Second pass: compute position / newlines / attachedTo / content.
  // We need to know the offset of the next non-trivia token AFTER each
  // comment to fill in `attachedTo`. Approach: scan forward from each
  // comment's end, skipping whitespace and any subsequent comments.
  function nextNonTriviaOffset(from: number): number {
    let p = from
    while (p < len) {
      const ch = source.charCodeAt(p)
      // Whitespace.
      if (
        ch === 32 /* space */ ||
        ch === 9 /* tab */ ||
        ch === 10 /* \n */ ||
        ch === 13 /* \r */
      ) {
        p += 1
        continue
      }
      // Line comment to skip.
      if (ch === 47 /* / */ && source.charCodeAt(p + 1) === 47 /* / */) {
        while (p < len && source.charCodeAt(p) !== 10) {
          p += 1
        }
        continue
      }
      // Block comment to skip.
      if (ch === 47 /* / */ && source.charCodeAt(p + 1) === 42 /* * */) {
        p += 2
        while (p < len - 1) {
          if (
            source.charCodeAt(p) === 42 /* * */ &&
            source.charCodeAt(p + 1) === 47 /* / */
          ) {
            p += 2
            break
          }
          p += 1
        }
        continue
      }
      return p
    }
    return -1
  }

  function hasNewlineBefore(offset: number): boolean {
    let p = offset - 1
    while (p >= 0) {
      const ch = source.charCodeAt(p)
      if (ch === 10 /* \n */ || ch === 13 /* \r */) {
        return true
      }
      if (ch !== 32 && ch !== 9) {
        return false
      }
      p -= 1
    }
    // Start-of-file counts as having a newline before (the start
    // boundary is effectively a newline for attachment purposes).
    return true
  }

  function hasNewlineAfter(offset: number): boolean {
    let p = offset
    while (p < len) {
      const ch = source.charCodeAt(p)
      if (ch === 10 /* \n */ || ch === 13 /* \r */) {
        return true
      }
      if (ch !== 32 && ch !== 9) {
        return false
      }
      p += 1
    }
    return true
  }

  return pending.map((pc): CommentSite => {
    // Position: a comment is Trailing if there's NO newline before it
    // AND there IS a token earlier on the same line. Easiest detector:
    // the preceding source line up to `start` contains a non-comment
    // non-whitespace char with no intervening newline.
    const before = hasNewlineBefore(pc.start)
    const after = hasNewlineAfter(pc.end)
    const position: CommentPosition = before ? 'Leading' : 'Trailing'
    const attachedTo = position === 'Leading' ? nextNonTriviaOffset(pc.end) : -1
    const content = classifyCommentContent(pc.kind, pc.fullText, pc.value)
    return {
      kind: pc.kind,
      content,
      position,
      newlines: { before, after },
      start: pc.start,
      end: pc.end,
      attachedTo,
      value: pc.value,
      line: pc.line,
      text: pc.text,
    }
  })
}

/**
 * Visit every node in `source` whose type matches a key in `visitors`. Errors
 * during parse are silently swallowed — see `tryParse` for the
 * fragment-tolerance rationale.
 */
export function walkSimple(
  source: string,
  visitors: Record<string, (node: AcornNode) => void>,
  options?: ParseOptions | undefined,
): void {
  try {
    wasmSimple(
      source,
      visitors as unknown as Record<string, (node: unknown) => void>,
      {
        __proto__: null,
        ...DEFAULT_PARSE_OPTIONS,
        ...options,
      } as unknown as ParseOptions,
    )
  } catch {
    // Parse failure — caller's hook should fail open.
  }
}
