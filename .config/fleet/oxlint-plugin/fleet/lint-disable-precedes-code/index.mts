/*
 * @file A `-disable-next-line` directive applies to THE NEXT LINE. When the next
 *   line is a comment, the directive lands on that comment instead of on the
 *   code, so its rule is never suppressed and the build stays red for a reason
 *   nobody can see by reading the two lines. Both spellings of the mistake look
 *   deliberate:
 *
 *     // oxlint-disable-next-line socket/example-rule -- reason
 *     // oxlint-disable-next-line socket/example-rule-two -- reason      <- suppresses nothing
 *     doTheThing()
 *
 *     // eslint-disable-next-line no-await-in-loop -- sequential by design
 *     // the rest of the explanation ran onto a second line               <- same
 *     await doTheThing()
 *
 *   Two suppressions go on ONE directive, comma-separated, which is the form
 *   both linters read:
 *
 *     // oxlint-disable-next-line socket/example-rule, socket/example-rule-two -- one short reason
 *     doTheThing()
 *
 *   Scoped to LINTER directives on purpose. A fleet `socket-lint: allow <rule>`
 *   marker looks like the same thing and is not: `makeBypassChecker` walks the
 *   whole contiguous leading-comment block, so that marker legitimately sits
 *   anywhere above the code and stacking it is correct. Only the check-scripts
 *   that read their marker per line (private-path, personal-path) need it on
 *   the line carrying what it excuses, and those cannot be told apart from the
 *   block-scoped ones by syntax.
 *
 *   An explanation belongs ABOVE the directive, the shape
 *   `terse-lint-disable-reason` already asks for, so the directive stays
 *   adjacent to the code.
 *
 *   Reference: https://oxc.rs/docs/guide/usage/linter/ignore-comments.html
 *
 *   Reads the source LINES rather than comment nodes, because adjacency is a
 *   line-shaped property and a comment node's shape varies by parser. Not
 *   fixable: merging two directives leaves ONE reason, and which words survive
 *   is prose only the author can pick.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

/**
 * A line-scoped disable directive in either linter's spelling, capturing the
 * indentation and everything the directive carries. Rule names hold hyphens
 * (`no-console`), so the rule list and the reason are split on the ` -- `
 * separator afterward rather than by a character class here.
 */
const DISABLE_NEXT_LINE_RE =
  /^(?<indent>\s*)\/\/\s*(?:eslint|oxlint)-disable-next-line\s+(?<body>\S.*?)\s*$/

/**
 * The ` -- ` that separates a directive's rule list from its reason.
 */
const REASON_SEPARATOR = ' -- '

/**
 * Whether `line` is a line-scoped disable directive written as a `//` comment.
 *
 * Pure and exported so adjacency and merging are tested on plain strings.
 */
export function isDisableNextLine(line: string): boolean {
  return DISABLE_NEXT_LINE_RE.test(line)
}

/**
 * The rule names a directive line suppresses, in written order.
 *
 * Answers an empty array for a line that is not a directive, so a caller can
 * concatenate without a guard at each site.
 */
export function disabledRuleNames(line: string): string[] {
  const body = DISABLE_NEXT_LINE_RE.exec(line)?.groups?.['body']
  if (!body) {
    return []
  }
  const separatorAt = body.indexOf(REASON_SEPARATOR)
  const rules = separatorAt === -1 ? body : body.slice(0, separatorAt)
  return rules
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
}

/**
 * The reason a directive line carries after `--`, or undefined when it has
 * none.
 */
export function disableReason(line: string): string | undefined {
  const body = DISABLE_NEXT_LINE_RE.exec(line)?.groups?.['body']
  if (!body) {
    return undefined
  }
  const separatorAt = body.indexOf(REASON_SEPARATOR)
  if (separatorAt === -1) {
    return undefined
  }
  const reason = body.slice(separatorAt + REASON_SEPARATOR.length).trim()
  return reason || undefined
}

/**
 * The single directive that stacked `lines` should have been written as: every
 * rule name in order, deduped, with the first reason present.
 *
 * Answers undefined when `lines` holds fewer than two directives, so the
 * caller reports only what it can name a replacement for. Shown in the message
 * so the fix is a copy, not a rewrite.
 */
export function mergeDisableDirectives(
  lines: readonly string[],
): string | undefined {
  if (lines.length < 2 || !lines.every(isDisableNextLine)) {
    return undefined
  }
  const names: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const found = disabledRuleNames(lines[i]!)
    for (let j = 0, count = found.length; j < count; j += 1) {
      if (!names.includes(found[j]!)) {
        names.push(found[j]!)
      }
    }
  }
  if (!names.length) {
    return undefined
  }
  const indent = DISABLE_NEXT_LINE_RE.exec(lines[0]!)?.groups?.['indent'] ?? ''
  const reason = lines.map(disableReason).find(Boolean)
  const directive = `${indent}// oxlint-disable-next-line ${names.join(', ')}`
  return reason ? `${directive} -- ${reason}` : directive
}

/**
 * Whether `line` is any comment line, which is what a directive must NOT be
 * followed by.
 */
export function isCommentLine(line: string): boolean {
  return /^\s*(?:\*|\/\*|\/\/)/.test(line)
}

/**
 * Every run of two or more adjacent directive lines in `text`, as 1-indexed
 * line numbers. Pure; the stacked-directive half of the scanner.
 */
export function findStackedDisableRuns(text: string): number[][] {
  const lines = splitLines(text)
  const runs: number[][] = []
  let run: number[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (isDisableNextLine(lines[i]!)) {
      run.push(i + 1)
      continue
    }
    if (run.length > 1) {
      runs.push(run)
    }
    run = []
  }
  if (run.length > 1) {
    runs.push(run)
  }
  return runs
}

/**
 * Every 1-indexed line holding a directive whose next line is an ORDINARY
 * comment, so the directive suppresses that comment and nothing else. A
 * directive followed by another directive belongs to
 * {@link findStackedDisableRuns} instead, which names a merge for it.
 */
export function findDisablesAboveComments(text: string): number[] {
  const lines = splitLines(text)
  const found: number[] = []
  for (let i = 0, { length } = lines; i < length - 1; i += 1) {
    if (
      isDisableNextLine(lines[i]!) &&
      isCommentLine(lines[i + 1]!) &&
      !isDisableNextLine(lines[i + 1]!)
    ) {
      found.push(i + 1)
    }
  }
  return found
}

/**
 * Lines of `text` with CRLF normalized away, so a trailing `\r` can never
 * ride into an adjacency read.
 */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

/**
 * Reports `messageId` against the whole of line `lineNumber`, so both findings
 * anchor the same way.
 */
function report(
  context: RuleContext,
  node: AstNode,
  lines: readonly string[],
  lineNumber: number,
  messageId: string,
  data: Record<string, string>,
): void {
  context.report({
    node,
    loc: {
      start: { column: 0, line: lineNumber },
      end: { column: (lines[lineNumber - 1] ?? '').length, line: lineNumber },
    },
    messageId,
    data,
  })
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep a `-disable-next-line` directly above the code it suppresses; a directive followed by a comment suppresses that comment instead.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      stackedDisables:
        'This `-disable-next-line` applies to the directive on the next line, not to the code, so its rule is never suppressed. Write one comma-separated directive instead: `{{merged}}`.',
      disableAboveComment:
        'This `-disable-next-line` applies to the comment on the next line, not to the code, so its rule is never suppressed. Move the explanation ABOVE the directive, leaving the directive touching the code.',
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
        const lines = splitLines(text)
        const runs = findStackedDisableRuns(text)
        for (let i = 0, { length } = runs; i < length; i += 1) {
          const run = runs[i]!
          const merged =
            mergeDisableDirectives(run.map(n => lines[n - 1]!)) ?? ''
          // Anchored on the FIRST directive of the run, the one whose rule
          // silently goes unsuppressed.
          report(context, node, lines, run[0]!, 'stackedDisables', {
            merged: merged.trim(),
          })
        }
        const aboveComments = findDisablesAboveComments(text)
        for (let i = 0, { length } = aboveComments; i < length; i += 1) {
          report(
            context,
            node,
            lines,
            aboveComments[i]!,
            'disableAboveComment',
            {},
          )
        }
      },
    }
  },
}

// The oxlint plugin contract requires a default-exported rule object.
// oxlint-disable-next-line socket/no-default-export -- plugin contract
export default rule
