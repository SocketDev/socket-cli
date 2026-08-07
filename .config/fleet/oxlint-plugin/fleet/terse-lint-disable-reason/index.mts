/*
 * @file Keep a lint-disable line inside the column limit. A disable directive
 *   carries its reason after `--`, and a long reason pushes the line past
 *   printWidth. oxfmt cannot wrap a comment, so nothing fixes it and nothing
 *   else complains: the line just sits there, wider than every line around it,
 *   and a reviewer reads it by scrolling sideways.
 *
 *   The fix is placement, not deletion. A disable line answers WHICH rule and,
 *   briefly, WHY; the paragraph explaining the reasoning belongs on its own
 *   comment line above, where oxfmt's width applies to prose the same as to
 *   code:
 *
 *   ```
 *   // A cleared settings field is sent as JSON null; undefined drops the key.
 *   // oxlint-disable-next-line socket/prefer-undefined-over-null -- null is the value under test
 *   ```
 *
 *   Deliberately measures the LINE, not the reason. A short reason on a deeply
 *   indented line still overflows, and the column limit is the thing being
 *   protected. No autofix: only the author knows which half of the sentence is
 *   the short phrase and which is the paragraph.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

/**
 * The column limit when `.editorconfig` cannot be read, matching the value it
 * declares. A fallback, never the source of truth.
 */
export const DEFAULT_PRINT_WIDTH = 80

/**
 * The narrowest reason worth asking for, in columns. A long rule name on an
 * indented line can leave only a few columns before the limit, and a phrase
 * that short says nothing a reader can use. Below this the finding would be an
 * instruction nobody can follow, so the line is left alone.
 */
export const MIN_REASON_COLUMNS = 16

/**
 * `max_line_length` from the nearest `.editorconfig`, walking up from `fromDir`
 * to the filesystem root. Answers undefined when no ancestor declares one.
 *
 * `.editorconfig` is where a repo states its column limit for every editor and
 * tool, so it is the one place this rule reads. Duplicating the number here
 * would put the limit in two files that drift.
 *
 * Pure over the filesystem apart from the reads, and exported for tests.
 */
export function readEditorConfigLineLength(
  fromDir: string,
  readFile: (filePath: string) => string | undefined = defaultReadFile,
): number | undefined {
  let dir = fromDir
  for (;;) {
    const text = readFile(path.join(dir, '.editorconfig'))
    if (text !== undefined) {
      const match = /^\s*max_line_length\s*=\s*(\d+)\s*$/m.exec(text)
      if (match) {
        return Number.parseInt(match[1]!, 10)
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

/**
 * Reads a file, answering undefined when it is absent or unreadable. The
 * default seam {@link readEditorConfigLineLength} walks with; exported so a
 * test can assert the swallow rather than reach the filesystem to prove it.
 */
export function defaultReadFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * A disable directive in either linter's spelling, with a reason after `--`.
 * The reason is what makes these lines long, so a directive without one cannot
 * overflow for the reason this rule exists to catch.
 */
// Not anchored to the line start, and `-line` is spelled out alongside
// `-next-line`. A trailing `code() // oxlint-disable-line rule -- reason` is
// the same directive with the same width problem, and the earlier
// start-anchored pattern let it through: moving a long directive onto the code
// line evaded the rule entirely rather than fixing anything.
const DISABLE_WITH_REASON_RE =
  /(?:\/\*|\/\/)\s*(?:eslint|oxlint)-disable(?:-line|-next-line)?\s+\S+.*--\s*\S/

/**
 * Whether `line`, exactly as authored, is a disable directive carrying a reason
 * and running past the limit.
 *
 * Pure and exported so the behavior is tested directly on strings. The rule
 * body only locates candidate lines; every judgment lives here.
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

export function isOverlongDisableLine(
  line: string,
  limit: number = DEFAULT_PRINT_WIDTH,
): boolean {
  if (
    isIllustratedDirective(line) ||
    !DISABLE_WITH_REASON_RE.test(line) ||
    line.length <= limit
  ) {
    return false
  }
  // Only report what the author can act on. A directive naming several rules
  // can exceed the limit on its rule list alone, and no amount of moving prose
  // upward shortens it. Measure the line with the reason cut to one token: if
  // that STILL overflows, the width is irreducible and the finding would be an
  // instruction the reader cannot follow. Splitting such a directive into a
  // file-scope disable is worse, because `no-file-scope-oxlint-disable` bans
  // that outright. The same holds a notch earlier: a directive that fits but
  // leaves under MIN_REASON_COLUMNS has no room for a phrase worth reading.
  return limit - withMinimalReason(line).length + 1 >= MIN_REASON_COLUMNS
}

/**
 * The line as it would read with the shortest useful reason, which is the
 * floor {@link isOverlongDisableLine} measures actionability against.
 */
export function withMinimalReason(line: string): string {
  return line.replace(
    /(\s--\s).*$/,
    (_match: string, separator: string) => `${separator}x`,
  )
}

/**
 * Every 1-indexed line number in `text` that {@link isOverlongDisableLine}
 * rejects. Pure; the scanner half of the rule.
 */
export function findOverlongDisableLines(
  text: string,
  limit: number = DEFAULT_PRINT_WIDTH,
): number[] {
  const found: number[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (isOverlongDisableLine(lines[i]!, limit)) {
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
        'Keep a lint-disable line within printWidth; move the explanation to the line above.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      longDisableReason:
        'This lint-disable line is {{width}} columns, past the {{limit}} limit, and oxfmt cannot wrap a comment. Keep a short phrase after `--` and move the explanation to its own comment line above.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    // Resolved from the LINTED FILE's own tree, so a repo that sets a different
    // max_line_length is measured against its own limit rather than the
    // fleet's. Read once per file, not once per line.
    const filename = context.filename ?? context.getFilename?.() ?? ''
    const limit =
      (filename
        ? readEditorConfigLineLength(path.dirname(filename))
        : undefined) ?? DEFAULT_PRINT_WIDTH
    return {
      // Scans the SOURCE TEXT rather than the comment nodes. A disable
      // directive is a line-shaped thing, and its authored width - indentation
      // included - is exactly what the limit governs, so reading the raw lines
      // measures the property directly instead of reconstructing it from a
      // comment node whose shape varies by parser.
      Program(node: AstNode) {
        const text: string = sourceCode.getText ? sourceCode.getText() : ''
        if (!text) {
          return
        }
        const lines = text.split('\n')
        const overlong = findOverlongDisableLines(text, limit)
        for (let i = 0, { length } = overlong; i < length; i += 1) {
          const lineNumber = overlong[i]!
          const width = (lines[lineNumber - 1] ?? '').length
          context.report({
            node,
            loc: {
              start: { column: 0, line: lineNumber },
              end: { column: width, line: lineNumber },
            },
            messageId: 'longDisableReason',
            data: { limit: String(limit), width: String(width) },
          })
        }
      },
    }
  },
}

// The oxlint plugin contract requires a default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- plugin contract
export default rule
