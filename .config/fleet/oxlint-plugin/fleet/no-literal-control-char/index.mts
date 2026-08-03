/*
 * @file Ban a RAW control character in source; require the `\uXXXX` escape.
 *
 *   A literal ESC, NUL, or BEL byte is invisible. It renders as nothing in a
 *   terminal, nothing in `rg` output, and nothing in a diff, so the source
 *   reads as if the character is absent. An ANSI-stripping regex written with
 *   a raw ESC and one written without it look IDENTICAL on screen and behave
 *   completely differently: the first strips escape sequences, the second
 *   leaves every escape byte in place and eats bracketed literal text instead.
 *
 *   That cost two consecutive wrong diagnoses on one ANSI stripper. A working
 *   pattern was declared broken, "fixed" into a real bug, and only `cat -v`
 *   settled it. The escaped form says the same thing to the engine while
 *   staying legible to a reader, a grep, and a review.
 *
 *   NOT `eslint/no-control-regex`, which bans control characters in a regex
 *   outright, escaped or not. Stripping ANSI legitimately needs one; the
 *   defect is the SPELLING, not the character.
 *
 *   Exempt: tab, newline, and carriage return. They are conventional in source
 *   and their literal forms are unambiguous.
 *
 *   Detection is by CODE POINT, never a character class. A class listing these
 *   bytes would have to contain them, so the rule's own source would trip the
 *   rule and be just as unreadable as the code it rejects.
 *
 *   Autofix: rewrite the raw byte as `\uXXXX` in place.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Readable names for the control bytes worth naming, so a message says WHICH
// byte was found rather than printing the invisible thing itself.
const CONTROL_NAMES: Readonly<Record<number, string>> = {
  0x00: 'NUL',
  0x07: 'BEL',
  0x08: 'BS',
  0x0b: 'VT',
  0x0c: 'FF',
  0x1b: 'ESC',
  0x7f: 'DEL',
}

// Tab, newline, carriage return. Conventional in source, unambiguous raw.
const EXEMPT_CODES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d])

/**
 * True when `code` is a C0 control or DEL that must be written escaped.
 */
export function isBannedControlCode(code: number): boolean {
  if (EXEMPT_CODES.has(code)) {
    return false
  }
  return (code >= 0x00 && code <= 0x1f) || code === 0x7f
}

/**
 * The `\uXXXX` spelling of a character, zero-padded to four hex digits.
 */
export function toUnicodeEscape(char: string): string {
  const hex = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
  return `\\u${hex}`
}

/**
 * A readable name for a control character — its common mnemonic when it has
 * one, otherwise its code point.
 */
export function controlCharName(char: string): string {
  const code = char.codePointAt(0)!
  return (
    CONTROL_NAMES[code] ??
    `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  )
}

/**
 * The first banned raw control character in `text`, or undefined when clean.
 */
export function firstRawControlChar(text: string): string | undefined {
  for (let i = 0, { length } = text; i < length; i += 1) {
    if (isBannedControlCode(text.charCodeAt(i))) {
      return text[i]
    }
  }
  return undefined
}

/**
 * Rewrite every banned raw control character in `text` as its escape.
 */
export function escapeRawControls(text: string): string {
  let out = ''
  for (let i = 0, { length } = text; i < length; i += 1) {
    const char = text[i]!
    out += isBannedControlCode(char.charCodeAt(0))
      ? toUnicodeEscape(char)
      : char
  }
  return out
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      category: 'Best Practices',
      description:
        'Ban a raw control character in source; use the \\uXXXX escape.',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      raw: 'Raw {{name}} control character — invisible in a grep, a diff, and a terminal, so this reads as if it is not there. Write it as {{escape}}.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const source = context.sourceCode ?? context.getSourceCode?.()

    /**
     * Report `node` when its own source text carries a banned raw control
     * character, and offer the escaped rewrite.
     */
    function checkNode(node: AstNode): void {
      const raw = source?.getText?.(node)
      if (!raw) {
        return
      }
      const found = firstRawControlChar(raw)
      if (found === undefined) {
        return
      }
      context.report({
        data: {
          escape: toUnicodeEscape(found),
          name: controlCharName(found),
        },
        fix(fixer: RuleFixer) {
          return fixer.replaceText(node, escapeRawControls(raw))
        },
        messageId: 'raw',
        node,
      })
    }

    return {
      Literal: checkNode,
      TemplateElement: checkNode,
    }
  },
}

export default rule
