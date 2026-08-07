/*
 * @file A lint-disable reason must be a phrase, not a sentence cut in half.
 *
 *   Sibling to `terse-lint-disable-reason`, which measures the LINE's width.
 *   This measures whether the reason still READS. The two exist together
 *   because satisfying width alone has a cheap wrong answer: cut the sentence
 *   at column 80 and push the tail onto a comment line above. That passes the
 *   width rule and produces this, which a reader meets back to front:
 *
 *     // sync stdin/stdout + typed string return; v5 omits 'encoding'.
 *     // oxlint-disable-next-line socket/prefer-async-spawn -- hooks+runner
 *
 *   A sweep over this tree did exactly that at scale, so the rule exists to
 *   make the shortcut fail rather than to be remembered.
 *
 *   The signal is the reason's LAST WORD. A phrase written to stand alone ends
 *   on a content word: `-- plugin contract`, `-- dep-0`, `-- broken symlink`. A
 *   phrase cut mid-sentence ends on a function word, because that is where a
 *   column boundary lands: `-- hook + runner need`, `-- sequential by design:
 *   a`, `-- the`. Articles, prepositions, conjunctions, and auxiliaries carry
 *   no meaning without what follows them, so ending on one is the tell.
 *
 *   Deliberately narrow. It does NOT test whether the explanation above starts
 *   lowercase, which looks like the same signal and is not: a correctly wrapped
 *   explanation is one sentence across several lines, and prose legitimately
 *   opens on a lowercase identifier (`normalizePath COLLAPSES …`). Testing that
 *   flagged 161 sound comments in this tree against zero real ones. The last
 *   word alone flags the real shape and nothing else.
 *
 *   No autofix. Repair means rejoining the reason with the explanation above
 *   and re-cutting at a clause break, and only the author knows which half is
 *   the phrase.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

/**
 * Words that cannot end a standalone phrase. Articles, prepositions,
 * conjunctions, and auxiliaries: each one points at something that has to
 * follow it, so a reason ending here was cut off.
 */
export const DANGLING_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'need',
  'needs',
  'no',
  'not',
  'of',
  'on',
  'or',
  'per',
  'plus',
  'so',
  'than',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'via',
  'was',
  'when',
  'while',
  'with',
])

/**
 * A disable directive carrying a reason after `--`.
 */
const DIRECTIVE_RE =
  /^(?!\s*\*)(?:[^`\n]*?)(?:\/\*|\/\/)\s*(?:eslint|oxlint)-disable(?:-line|-next-line)?\s+\S+.*?\s--\s+(?<reason>.+?)\s*(?:\*\/)?$/

/**
 * The reason's last word, lowercased and stripped of punctuation, or an empty
 * string when there is none to judge.
 */
export function lastReasonWord(reason: string): string {
  const words = reason.trim().split(/\s+/).filter(Boolean)
  const last = words[words.length - 1] ?? ''
  return last.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/**
 * Whether a disable line's reason was cut mid-sentence.
 *
 * Pure and exported so the judgment is tested on strings directly; the rule
 * body only walks lines.
 */
/**
 * True when a directive on `line` is being SHOWN rather than applied: a JSDoc
 * continuation (` * ...`) inside a doc block, or one quoted inside backticks.
 * Neither reaches the linter, so judging their width or wording would flag the
 * documentation that explains the rule.
 */
export function isIllustratedDirective(line: string): boolean {
  if (/^\s*\*/.test(line)) {
    return true
  }
  const directiveAt = line.search(/(?:eslint|oxlint)-disable/)
  return directiveAt !== -1 && line.slice(0, directiveAt).includes('`')
}

export function isTruncatedDisableLine(line: string): boolean {
  if (isIllustratedDirective(line)) {
    return false
  }
  const reason = DIRECTIVE_RE.exec(line)?.groups?.['reason']
  if (!reason) {
    return false
  }
  return DANGLING_WORDS.has(lastReasonWord(reason))
}

/**
 * Every 1-indexed line in `text` whose disable reason reads as truncated.
 */
export function findTruncatedDisableLines(text: string): number[] {
  const found: number[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (isTruncatedDisableLine(lines[i]!)) {
      found.push(i + 1)
    }
  }
  return found
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A lint-disable reason must read as a phrase, not a sentence cut at the column limit.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      truncatedReason:
        'This lint-disable reason ends on "{{word}}", so it was cut mid-sentence rather than written as a phrase. Rejoin it with the explanation above, then cut at a clause break: keep the first clause after `--` and put the whole sentence on comment lines above.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    return {
      Program(node: AstNode) {
        const text: string = sourceCode.getText ? sourceCode.getText() : ''
        if (!text) {
          return
        }
        const lines = text.replace(/\r\n/g, '\n').split('\n')
        const truncated = findTruncatedDisableLines(text)
        for (let i = 0, { length } = truncated; i < length; i += 1) {
          const lineNumber = truncated[i]!
          const lineText = lines[lineNumber - 1] ?? ''
          const reason = DIRECTIVE_RE.exec(lineText)?.groups?.['reason'] ?? ''
          context.report({
            node,
            loc: {
              start: { column: 0, line: lineNumber },
              end: { column: lineText.length, line: lineNumber },
            },
            messageId: 'truncatedReason',
            data: { word: lastReasonWord(reason) },
          })
        }
      },
    }
  },
}

// The oxlint plugin contract requires a default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- plugin contract
export default rule
