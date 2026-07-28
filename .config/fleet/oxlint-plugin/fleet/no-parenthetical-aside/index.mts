/**
 * @file Flag a PROSE parenthetical aside inside a comment. The fleet house
 *   style forbids `(...)` asides in prose — a clause set off in parentheses
 *   reads as an afterthought and should be rewritten with commas, a colon, or
 *   an em-dash. This rule walks every comment via `sourceCode.getAllComments()`
 *   and reports each `(...)` group that is natural-language prose per the pure,
 *   exported `isParentheticalAside`. It is deliberately CONSERVATIVE and, above
 *   all, CONTEXT-AWARE: a `(...)` group is treated as a code reference and
 *   skipped — never flagged, never fixed — whenever it is a call or index such
 *   as `probe(toolsFile, keys)`, sits after a control-flow keyword such as `for
 *   (const item of arr)`, falls inside a backtick inline-code span such as
 *   `` `fn(a, b)` ``, or its inner text carries a code shape per the pure
 *   inner-only `innerLooksLikeCode`. Autofix rewrites each flagged `(X)` aside
 *   into comma-delimited appositive prose via the pure, exported
 *   `rewriteAsides`: ` word (X) rest` becomes ` word, X, rest`, and ` word (X)`
 *   at a clause or comment end becomes ` word, X`. Commas, not em-dashes: an
 *   em-dash chain would trip the fleet anti-prose guard.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// A parenthesized group and its inner text. Matches innermost groups only — the
// `[^()]` char class stops at a nested paren — so a call quoted in a comment
// such as `basename(x)` yields the inner `x`, and nested parens never leak in.
const GROUP_RE = /\([^()]*\)/g

// A single code-punctuation character. Its presence anywhere in a group's inner
// text disqualifies the group: none of these appears in a natural-language
// aside, and every one is common in a code fragment. Underscore is included so
// a snake_case identifier reads as code. The `|` inside this class is a literal
// char, not an alternation.
const CODE_PUNCT_RE = /[=<>{}[\]|&;:/\\`$@#*+~^%_]/

// A dot flanked by word characters is member access or an abbreviation such as
// `path.basename` or `e.g.` — a code shape, not prose.
const MEMBER_DOT_RE = /\w\.\w/

// A digit touching any non-space marks a value or version such as `0o200` or
// `v1.0.14`.
const DIGIT_LEADING_RE = /\d\S/
const DIGIT_TRAILING_RE = /\S\d/

// A lowercase letter immediately followed by an uppercase letter is an internal
// capital: a camelCase or PascalCase identifier such as `toolsFile` or
// `execFileSync`. Prose words are all-lowercase or sentence-cased, so this
// never fires on natural language.
const CAMEL_RE = /[a-z][A-Z]/

// An identifier immediately followed by an open paren is a call. Inner text
// from GROUP_RE never holds a paren, so this only ever fires via a wider scan;
// kept for completeness of the code-shape test.
const CALL_RE = /[A-Za-z_]\(/

// A prose word: a letter followed by letters, apostrophes, or hyphens.
const WORD_RE = /^[A-Za-z][A-Za-z'-]*$/

// An ALL_CAPS token of two or more letters is a name or acronym, not prose.
const SHOUT_RE = /^[A-Z][A-Z'-]*[A-Z]$/

// One or more spaces — the token separator inside a group's inner text.
const SPACE_RE = / +/

// The char immediately before a `(` that means it is a call, index, or member
// access rather than a prose aside: a word char, a closer `)` or `]`, a
// backtick, or a member dot. A genuine aside always has whitespace or the
// comment start before its `(`.
const NO_GAP_RE = /[\w)\].`]/

// The prose word ending just before the space that precedes a `(`. Used to see
// whether a JS keyword introduces the group.
const PRECEDING_WORD_RE = /([A-Za-z]+)\s+$/

// JS control-flow and operator keywords. A `(` right after one of these words
// opens a language construct such as `for (…)` or `catch (…)`, never a prose
// aside.
const KEYWORDS = new Set([
  'await',
  'catch',
  'delete',
  'do',
  'else',
  'for',
  'function',
  'if',
  'in',
  'new',
  'of',
  'return',
  'super',
  'switch',
  'throw',
  'typeof',
  'void',
  'while',
  'yield',
])

// A parenthesized group plus any spaces hugging it. The surrounding spaces are
// captured so the fixer can rebind the aside to its neighbors: the leading
// space is dropped in favor of a comma, the trailing space is re-emitted or
// swapped for a comma depending on what follows.
const ASIDE_RE = /( *)\(([^()]*)\)( *)/g

// The final char of the preceding text ends a prose word — a comma should bind
// the aside to it. Backticks, quotes, and closers count as word ends so
// `` `foo` (aside) `` and `bar) (aside)` both bind cleanly.
const WORD_END_RE = /[A-Za-z0-9`'")\]]/

// The first char of the following text begins the next prose token — the aside
// needs a trailing comma before it.
const WORD_START_RE = /[A-Za-z0-9`'"([]/

// Sentence punctuation that hugs the preceding word. The aside closes right
// before it with no comma, since the punctuation already separates the clause.
const HUG_PUNCT_RE = /[.,;:!?]/

// A dash the aside should sit beside with a single space, never a comma — a
// comma before a dash reads as doubled punctuation.
const DASH_RE = /[—–-]/

/**
 * True when `inner` carries a code shape and so must never be read as prose.
 * Pure + inner-only, exported for the unit test. Covers punctuation, member
 * dots, adjacent digits, camelCase / PascalCase identifiers, ALL_CAPS tokens,
 * and an identifier-then-paren call.
 */
export function innerLooksLikeCode(inner: string): boolean {
  const trimmed = inner.trim()
  if (
    CODE_PUNCT_RE.test(trimmed) ||
    MEMBER_DOT_RE.test(trimmed) ||
    DIGIT_LEADING_RE.test(trimmed) ||
    DIGIT_TRAILING_RE.test(trimmed) ||
    CAMEL_RE.test(trimmed) ||
    CALL_RE.test(trimmed)
  ) {
    return true
  }
  const tokens = trimmed.split(SPACE_RE)
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const raw = tokens[i]!
    const word = raw.endsWith(',') ? raw.slice(0, -1) : raw
    if (SHOUT_RE.test(word)) {
      return true
    }
  }
  return false
}

/**
 * True when the `(` at `open` in `text` opens a code reference, not a prose
 * aside. Pure + exported for the unit test. A group is a code reference when
 * the char before `(` is a word char, closer, backtick, or dot (a call, index,
 * or member access), when a JS keyword introduces it, or when it sits inside a
 * backtick inline-code span.
 */
export function isCodeReference(text: string, open: number): boolean {
  const prev = open > 0 ? text[open - 1] : undefined
  // (a) No gap before `(`: a call, index, or member access.
  if (prev !== undefined && NO_GAP_RE.test(prev)) {
    return true
  }
  // (b) A JS control-flow keyword introduces the group.
  const before = text.slice(0, open)
  const kw = PRECEDING_WORD_RE.exec(before)
  if (kw && KEYWORDS.has(kw[1]!)) {
    return true
  }
  // (c) Inside a backtick inline-code span: an odd number of backticks precede
  // the `(`, so the group opens inside an unclosed `` `…` `` run.
  let ticks = 0
  for (let i = 0; i < open; i += 1) {
    if (text[i] === '`') {
      ticks += 1
    }
  }
  return ticks % 2 === 1
}

/**
 * True only when the group at `[open, close]` in `text` reads as a
 * natural-language parenthetical aside. Pure + exported for the unit test;
 * `text` is the full comment body and `open` / `close` are the offsets of the
 * group's `(` and `)`. Conservative by design: a code reference by context per
 * `isCodeReference`, a code shape per `innerLooksLikeCode`, or a lone token all
 * return false so a code fragment quoted in a comment is never flagged.
 */
export function isParentheticalAside(
  text: string,
  open: number,
  close: number,
): boolean {
  const trimmed = text.slice(open + 1, close).trim()
  // Multi-word only: a lone token such as `relPath`, `0o200`, or `utf8` is a
  // code identifier or value, never an aside.
  if (!trimmed.includes(' ')) {
    return false
  }
  if (isCodeReference(text, open) || innerLooksLikeCode(trimmed)) {
    return false
  }
  // Every space-separated token must read as a natural-language word.
  const tokens = trimmed.split(SPACE_RE)
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const raw = tokens[i]!
    // A trailing comma is prose punctuation between clauses; drop it first.
    const word = raw.endsWith(',') ? raw.slice(0, -1) : raw
    if (!WORD_RE.test(word)) {
      return false
    }
  }
  return true
}

/**
 * Every prose aside in `text`, each returned as its `(...)` snippet. Pure +
 * exported for the unit test; the rule reports once per snippet.
 */
export function proseAsides(text: string): string[] {
  const out: string[] = []
  const matches = text.matchAll(GROUP_RE)
  for (const m of matches) {
    const open = m.index
    const close = open + m[0].length - 1
    if (isParentheticalAside(text, open, close)) {
      out.push(m[0])
    }
  }
  return out
}

/**
 * Rewrite every prose parenthetical aside in `value` into comma-delimited
 * appositive prose, leaving every code reference untouched. Pure + exported for
 * the unit test; the fixer calls it on a comment's body text. For each flagged
 * `(X)`:
 *
 * - Bind the aside to the preceding word with `, ` when that word ends in a
 *   letter, digit, backtick, quote, or closer; otherwise keep the original
 *   leading space so a jsdoc marker or existing punctuation is preserved.
 * - Follow the aside with `, ` when more prose follows, drop to `` when the next
 *   char is sentence punctuation or a line break, and keep a single space when
 *   a dash follows. This never emits `, ,`, `,,`, or a double space, and
 *   re-running on already-fixed text is a no-op.
 */
export function rewriteAsides(value: string): string {
  return value.replace(
    ASIDE_RE,
    (
      match: string,
      preSpace: string,
      inner: string,
      postSpace: string,
      offset: number,
      str: string,
    ): string => {
      const open = offset + preSpace.length
      const close = open + 1 + inner.length
      if (!isParentheticalAside(str, open, close)) {
        return match
      }
      const clean = inner.trim()
      const prevChar = str[offset - 1]
      const nextChar = str[offset + match.length]
      const lead =
        prevChar !== undefined && WORD_END_RE.test(prevChar) ? ', ' : preSpace
      let trail: string
      if (nextChar === undefined || nextChar === '\n') {
        trail = ''
      } else if (HUG_PUNCT_RE.test(nextChar)) {
        trail = ''
      } else if (DASH_RE.test(nextChar)) {
        trail = postSpace || ' '
      } else if (WORD_START_RE.test(nextChar)) {
        trail = ', '
      } else {
        trail = postSpace
      }
      return `${lead}${clean}${trail}`
    },
  )
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid a prose parenthetical aside in a comment. Rewrite the clause with commas, a colon, or an em-dash instead of setting it off in parentheses.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      parentheticalAside:
        'Comment contains a prose parenthetical aside `{{snippet}}`. The fleet house style forbids `(...)` asides in prose — rewrite the clause with commas, a colon, or an em-dash.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program() {
        const comments: AstNode[] = sourceCode.getAllComments
          ? sourceCode.getAllComments()
          : []
        for (let i = 0, { length } = comments; i < length; i += 1) {
          const comment = comments[i]!
          const value = (comment.value as string) ?? ''
          const snippets = proseAsides(value)
          for (let j = 0, { length: n } = snippets; j < n; j += 1) {
            context.report({
              node: comment as unknown as AstNode,
              messageId: 'parentheticalAside',
              data: { snippet: snippets[j]! },
              // Every flagged snippet in a comment shares one whole-comment
              // rewrite: rewriteAsides clears them all at once, so the fix is
              // idempotent and identical across a comment's reports. The
              // comment's range covers its delimiters, so reconstruct them
              // around the rewritten body — `//` for a line comment, `/*…*/`
              // for a block comment — leaving the leader untouched.
              fix(fixer: {
                replaceText: (n: unknown, text: string) => unknown
              }) {
                const body = rewriteAsides(value)
                const fixed =
                  comment.type === 'Block' ? `/*${body}*/` : `//${body}`
                return fixer.replaceText(comment, fixed)
              },
            })
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
