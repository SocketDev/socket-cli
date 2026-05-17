/**
 * @fileoverview Ban `\n` inside string literals passed to
 * `logger.<method>(...)`. The logger's symbol-prefixed methods
 * (`success`, `fail`, `warn`, `info`) own the line-leading visual.
 * Embedding `\n` smuggles raw line breaks into a single call and
 * makes the output inconsistent with the indentation/grouping the
 * logger applies.
 *
 * Canonical rewrite: split the call into two. The blank line uses a
 * stream-matched logger call. The message uses a semantic method
 * picked from the emoji found in the string (✗/❌ → .fail,
 * ✓/✔/✅ → .success, ⚠ → .warn, etc.). The semantic method wins
 * over the original method name — `logger.error('\n✗ ...')` becomes
 * `logger.error('')` + `logger.fail('...')`.
 *
 * Stream mapping:
 *   .log        → stdout → blank uses logger.log('')
 *   .error / .fail / .success / .warn / .info / .step / .substep
 *               → stderr → blank uses logger.error('')
 *
 * Order:
 *   leading \n  → blank line first, then message
 *   trailing \n → message first, then blank line
 *
 * Catches:
 *   logger.error('\n✗ Build failed:', e)
 *     → logger.error('')
 *     → logger.fail('Build failed:', e)
 *
 *   logger.success('✓ Done\n')
 *     → logger.success('Done')
 *     → logger.error('')        // .success goes to stderr
 *
 *   logger.log(`build/${mode}/out\n`)
 *     → logger.log(`build/${mode}/out`)
 *     → logger.log('')          // .log goes to stdout
 *
 * Autofix scope:
 *   - Single-string-argument calls with leading or trailing `\n`
 *     (the dominant shape in scripts): autofix splits into two
 *     statements with the correct blank-line + semantic methods.
 *   - Multi-argument calls (label + payload) and embedded `\n`
 *     mid-string: no autofix. The fix needs author judgment because
 *     the original string may carry meaningful chars between the
 *     emoji and the rest, and the extra args change the rewrite
 *     shape. The warning text names both the stream-matched blank-
 *     line method and the emoji-matched semantic method.
 */

// stderr-bound methods (per Logger#getTargetStream). `log` is the
// only stdout-bound method; everything semantic + `error` go to
// stderr. Blank lines for these use `logger.error('')` so the
// blank-line + message land on the same stream.

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const STDERR_METHODS = new Set([
  'error',
  'fail',
  'info',
  'progress',
  'skip',
  'step',
  'substep',
  'success',
  'warn',
])

// All logger methods the rule checks. Excludes `dir`, `group`,
// `groupEnd`, etc. (no semantic-symbol shape).
const LOGGER_METHODS = new Set([
  'error',
  'fail',
  'info',
  'log',
  'progress',
  'skip',
  'step',
  'substep',
  'success',
  'warn',
])

/* oxlint-disable socket/no-status-emoji -- this rule defines the emoji→method table it scans for. */
// Mirrors @socketsecurity/lib-stable/logger's LOG_SYMBOLS (the table built
// by `symbols-builder.ts`). Each logger method has TWO render
// shapes — the Unicode form (used on terminals with unicode support)
// and the ASCII fallback (used otherwise). Authors hand-rolling a
// prefix may type either, plus closely-related variants:
//
//   method    Unicode  ASCII   common author variants
//   ───────   ───────  ─────   ──────────────────────
//   fail      ✖        ×       ✗ ✘ ❌ ❎ ✖️
//   info      ℹ        i       ℹ️
//   progress  ∴        :.      (rarely typed)
//   reason    ∴(dim)   :.(dim) (rarely typed; same shape as progress)
//   skip      ↻        @       (rarely typed)
//   step      →        >       (rarely typed)
//   success   ✔        √       ✓ ✅ ☑ ☑️ ✔️
//   warn      ⚠        ‼       ⚠️ ❗ ❕ 🚨 ⛔
//
// Two scan passes:
//
// 1. ANYWHERE — `UNAMBIGUOUS_EMOJI` covers symbols that don't appear
//    in normal log prose. The Unicode forms + the visually distinct
//    ASCII fallbacks (√ × ‼ :.) — none would naturally show up in
//    `logger.log('config loaded\n')`. Match anywhere in the string.
//
// 2. ANCHORED — `AMBIGUOUS_FALLBACK` covers fallbacks that DO appear
//    in normal prose: `i` (in any English word), `>` (math/chaining),
//    `@` (npm package refs, dirs), `:` (host:port, urls). Only match
//    when at the START of the string followed by whitespace — that's
//    the prefix shape the logger emits.
//
// Keep this in lockstep with `socket-lib/src/logger/symbols-
// builder.ts` and `socket-wheelhouse/template/.config/oxlint-plugin/
// rules/no-status-emoji.mts`.
// UNAMBIGUOUS — match anywhere in the string. These shapes don't
// appear in normal log prose. Includes both the Unicode forms +
// distinct emoji variants authors hand-write (✅ ❌ ❗ 🚨 etc.) +
// the visually unique ASCII fallbacks (√, ×, ‼).
const UNAMBIGUOUS_EMOJI = {
  // success / check
  '✓': 'success',
  '✔': 'success',
  '✔️': 'success',
  '✅': 'success',
  '☑': 'success',
  '☑️': 'success',
  '√': 'success',
  // fail / cross
  '✗': 'fail',
  '✘': 'fail',
  '✖': 'fail',
  '✖️': 'fail',
  '❌': 'fail',
  '❎': 'fail',
  '×': 'fail',
  // warn / caution
  '⚠': 'warn',
  '⚠️': 'warn',
  '❗': 'warn',
  '❕': 'warn',
  '🚨': 'warn',
  '⛔': 'warn',
  '‼': 'warn',
  // info
  'ℹ': 'info',
  'ℹ️': 'info',
}

// ANCHORED — match only at the start of the string, followed by
// whitespace. These shapes can appear in normal prose mid-string
// ("config → output", "a > b", "log :. info", "step ↻ retry") but
// at the prefix position they're status symbols. Mirrors how
// socket-lib's `stripLoggerSymbols` only strips at `^`.
const ANCHORED_FALLBACK = {
  '→': 'step',
  '>': 'step',
  '∴': 'progress',
  ':.': 'progress',
  '↻': 'skip',
  '@': 'skip',
  i: 'info',
}

const ANCHORED_FALLBACK_PREFIX_RE = new RegExp(
  `^(${Object.keys(ANCHORED_FALLBACK)
    .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\s`,
)
/* oxlint-enable socket/no-status-emoji */

const UNAMBIGUOUS_LIST = Object.keys(UNAMBIGUOUS_EMOJI)

/**
 * Return the first known status emoji + its method, or undefined.
 *
 * Two passes: unambiguous shapes match anywhere in the string;
 * ANCHORED_FALLBACK shapes only match at the start followed by
 * whitespace.
 */
function findStatusEmoji(
  value: string,
): { emoji: string; method: string | undefined } | undefined {
  // Strip a single leading whitespace burst (\n / spaces) so the
  // anchored scan sees the visible-character start. This is how the
  // logger renders too — `\n` then symbol then space.
  const trimmed = value.replace(/^[\n\r\t ]+/, '')

  const anchored = ANCHORED_FALLBACK_PREFIX_RE.exec(trimmed)
  if (anchored && anchored[1]) {
    return {
      emoji: anchored[1],
      method: (ANCHORED_FALLBACK as Record<string, string>)[anchored[1]],
    }
  }

  for (const emoji of UNAMBIGUOUS_LIST) {
    if (value.includes(emoji)) {
      return {
        emoji,
        method: (UNAMBIGUOUS_EMOJI as Record<string, string>)[emoji],
      }
    }
  }
  return undefined
}

/**
 * Return the blank-line logger call for a given message method.
 */
function blankCallFor(method: string): string {
  return STDERR_METHODS.has(method) ? "logger.error('')" : "logger.log('')"
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban \\n in string literals passed to logger.<method>(); split into a stream-matched blank-line call + an emoji-matched semantic call.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      leadingNewline:
        "String literal passed to logger.{{origMethod}}() starts with \\n. Replace with {{blankCall}} then logger.{{semanticMethod}}('...') (emoji {{emoji}} → .{{semanticMethod}}).",
      leadingNewlineNoEmoji:
        "String literal passed to logger.{{origMethod}}() starts with \\n. Replace with {{blankCall}} then logger.{{origMethod}}('...').",
      trailingNewline:
        "String literal passed to logger.{{origMethod}}() ends with \\n. Replace with logger.{{semanticMethod}}('...') then {{blankCall}} (emoji {{emoji}} → .{{semanticMethod}}).",
      trailingNewlineNoEmoji:
        "String literal passed to logger.{{origMethod}}() ends with \\n. Replace with logger.{{origMethod}}('...') then {{blankCall}}.",
      embeddedNewline:
        'String literal passed to logger.{{origMethod}}() contains an embedded \\n. Split into multiple logger calls so each line gets the right prefix.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    /**
     * Walk up from a node to its enclosing ExpressionStatement.
     * Returns undefined if the call isn't a top-level statement
     * (e.g. it's inside a conditional expression or assignment) —
     * those shapes are too contextual to autofix.
     */
    function enclosingStatement(node: AstNode): AstNode | undefined {
      let cur = node.parent
      while (cur) {
        if (cur.type === 'ExpressionStatement') {
          return cur
        }
        if (
          cur.type === 'BlockStatement' ||
          cur.type === 'Program' ||
          cur.type === 'FunctionDeclaration' ||
          cur.type === 'ArrowFunctionExpression' ||
          cur.type === 'FunctionExpression'
        ) {
          return undefined
        }
        cur = cur.parent
      }
      return undefined
    }

    /**
     * Find the indentation (leading whitespace on its line) of `node`.
     */
    function indentOf(node: AstNode): string {
      const text = sourceCode.getText()
      const start = node.range?.[0] ?? node.start
      if (typeof start !== 'number') {
        return ''
      }
      let lineStart = start
      while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart -= 1
      }
      let i = lineStart
      while (i < start && (text[i] === ' ' || text[i] === '\t')) {
        i += 1
      }
      return text.slice(lineStart, i)
    }

    /**
     * Quote a string for source output. Uses single quotes by
     * default; if the value contains a single quote, falls back to
     * double quotes.
     */
    function quoteString(value: string): string {
      if (!value.includes("'")) {
        return `'${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}'`
      }
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    }

    /**
     * If `node` is an argument of a call to `logger.<method>(...)`,
     * return that method name. Otherwise return undefined.
     */
    function loggerMethodForArg(node: AstNode) {
      const parent = node.parent
      if (!parent || parent.type !== 'CallExpression') {
        return undefined
      }
      if (!parent.arguments.includes(node)) {
        return undefined
      }
      const callee = parent.callee
      if (callee.type !== 'MemberExpression') {
        return undefined
      }
      const objectName =
        callee.object.type === 'Identifier' ? callee.object.name : undefined
      const propName =
        callee.property.type === 'Identifier' ? callee.property.name : undefined
      if (objectName !== 'logger' || !propName) {
        return undefined
      }
      if (!LOGGER_METHODS.has(propName)) {
        return undefined
      }
      return propName
    }

    function classifyNewline(value: string): string | undefined {
      if (value.startsWith('\n')) {
        return 'leading'
      }
      if (value.endsWith('\n')) {
        return 'trailing'
      }
      if (value.includes('\n')) {
        return 'embedded'
      }
      return undefined
    }

    /**
     * Build the report payload for a literal value bound to a
     * logger.<origMethod>(...) call. Emits an autofix only when the
     * call is `logger.X('<value>')` with exactly one Literal arg,
     * lives in a plain ExpressionStatement, and the newline placement
     * is leading or trailing (not embedded). Multi-arg + embedded
     * shapes stay unfixed — the rewrite needs author judgment.
     */
    function reportFor(node: AstNode, value: string, origMethod: string): void {
      const placement = classifyNewline(value)
      if (!placement) {
        return
      }

      if (placement === 'embedded') {
        context.report({
          node,
          messageId: 'embeddedNewline',
          data: { origMethod },
        })
        return
      }

      const found = findStatusEmoji(value)
      const semanticMethod = found?.method
      const emoji = found?.emoji
      // Stream of the message in the rewrite — semantic method wins
      // when there's a status emoji; otherwise stay with the original.
      const messageMethod = semanticMethod ?? origMethod
      const blankCall = blankCallFor(messageMethod)

      const messageIdSuffix = semanticMethod ? 'Newline' : 'NewlineNoEmoji'
      const messageId = `${placement}${messageIdSuffix}`

      // Build an autofix when the shape is safe to rewrite mechanically.
      // Requires: node is a plain string Literal (not a template quasi),
      // parent is a CallExpression with exactly one argument (this one),
      // and the call is the entire statement.
      let fixFn: ((fixer: RuleFixer) => unknown) | undefined
      const call = node.parent
      const stmt = call ? enclosingStatement(call) : undefined
      const isPlainStringLiteral =
        node.type === 'Literal' && typeof node.value === 'string'
      if (
        isPlainStringLiteral &&
        call &&
        call.type === 'CallExpression' &&
        call.arguments.length === 1 &&
        call.arguments[0] === node &&
        stmt
      ) {
        const stripped =
          placement === 'leading'
            ? value.replace(/^\n+/, '')
            : value.replace(/\n+$/, '')
        const indent = indentOf(stmt)
        const messageCall = `logger.${messageMethod}(${quoteString(stripped)})`
        const replacement =
          placement === 'leading'
            ? `${blankCall}\n${indent}${messageCall}`
            : `${messageCall}\n${indent}${blankCall}`
        // Replace the call itself (not the surrounding ExpressionStatement)
        // so any trailing `;` or comment stays put.
        fixFn = (fixer: RuleFixer) => fixer.replaceText(call, replacement)
      }

      context.report({
        node,
        messageId,
        data: {
          origMethod,
          semanticMethod: semanticMethod ?? origMethod,
          emoji: emoji ?? '',
          blankCall,
        },
        ...(fixFn ? { fix: fixFn } : {}),
      })
    }

    return {
      Literal(node: AstNode) {
        const value = typeof node.value === 'string' ? node.value : undefined
        if (!value || !value.includes('\n')) {
          return
        }
        const origMethod = loggerMethodForArg(node)
        if (!origMethod) {
          return
        }
        reportFor(node, value, origMethod)
      },
      TemplateLiteral(node: AstNode) {
        const origMethod = loggerMethodForArg(node)
        if (!origMethod) {
          return
        }
        // Identify the first quasi with a newline + classify it.
        // Autofix only applies when:
        //   - It's the FIRST quasi with leading-\n, OR the LAST quasi
        //     with trailing-\n
        //   - The call has exactly one argument (this template)
        //   - The template lives in a plain ExpressionStatement
        // Mixed shapes (embedded \n, multiple newlines, non-edge
        // quasi) get reported without an autofix.
        const firstQuasi = node.quasis[0]
        const lastQuasi = node.quasis[node.quasis.length - 1]
        const firstCooked = firstQuasi?.value?.cooked
        const lastCooked = lastQuasi?.value?.cooked
        const call = node.parent
        const stmt = call ? enclosingStatement(call) : undefined
        const isSingleArgCall =
          call &&
          call.type === 'CallExpression' &&
          call.arguments.length === 1 &&
          call.arguments[0] === node &&
          stmt
        let handled = false
        if (
          isSingleArgCall &&
          typeof firstCooked === 'string' &&
          firstCooked.startsWith('\n') &&
          // No other newlines anywhere else.
          node.quasis.every((q: AstNode, i: number) => {
            const c = q.value?.cooked
            if (typeof c !== 'string') return false
            if (i === 0) return c.lastIndexOf('\n') === 0
            return !c.includes('\n')
          })
        ) {
          handled = true
          // Compute fix: replace the call. Rebuild the template body.
          const indent = indentOf(stmt)
          const newFirst = firstCooked.replace(/^\n+/, '')
          const src = sourceCode.getText()
          const start = node.range?.[0] ?? node.start
          const end = node.range?.[1] ?? node.end
          if (typeof start === 'number' && typeof end === 'number') {
            const originalTpl = src.slice(start, end)
            // The original template starts with backtick then the
            // raw first-quasi content. Strip the leading newline(s)
            // from the source representation to keep escape parity.
            const newTpl = '`' + originalTpl.slice(1).replace(/^\\?n+/, '').replace(/^\n+/, '')
            const found = findStatusEmoji(firstCooked)
            const semanticMethod = found?.method ?? origMethod
            const blankCall = blankCallFor(semanticMethod)
            const newCall = `logger.${semanticMethod}(${newTpl})`
            const replacement = `${blankCall}\n${indent}${newCall}`
            context.report({
              node: firstQuasi,
              messageId: found ? 'leadingNewline' : 'leadingNewlineNoEmoji',
              data: {
                origMethod,
                semanticMethod,
                emoji: found?.emoji ?? '',
                blankCall,
              },
              fix(fixer: RuleFixer) {
                return fixer.replaceText(call, replacement)
              },
            })
            return
          }
        }
        if (
          isSingleArgCall &&
          !handled &&
          typeof lastCooked === 'string' &&
          lastCooked.endsWith('\n') &&
          node.quasis.every((q: AstNode, i: number, arr: AstNode[]) => {
            const c = q.value?.cooked
            if (typeof c !== 'string') return false
            if (i === arr.length - 1) {
              // Last quasi: only the trailing-\n run is allowed.
              const trimmed = c.replace(/\n+$/, '')
              return !trimmed.includes('\n')
            }
            return !c.includes('\n')
          })
        ) {
          handled = true
          const indent = indentOf(stmt)
          const src = sourceCode.getText()
          const start = node.range?.[0] ?? node.start
          const end = node.range?.[1] ?? node.end
          if (typeof start === 'number' && typeof end === 'number') {
            const originalTpl = src.slice(start, end)
            // Strip trailing-newline from the source rep before the
            // closing backtick.
            const newTpl =
              originalTpl.slice(0, -1).replace(/(?:\\n|\n)+$/, '') + '`'
            const found = findStatusEmoji(lastCooked)
            const semanticMethod = found?.method ?? origMethod
            const blankCall = blankCallFor(semanticMethod)
            const newCall = `logger.${semanticMethod}(${newTpl})`
            const replacement = `${newCall}\n${indent}${blankCall}`
            context.report({
              node: lastQuasi,
              messageId: found ? 'trailingNewline' : 'trailingNewlineNoEmoji',
              data: {
                origMethod,
                semanticMethod,
                emoji: found?.emoji ?? '',
                blankCall,
              },
              fix(fixer: RuleFixer) {
                return fixer.replaceText(call, replacement)
              },
            })
            return
          }
        }
        // Fallback: report without fix for shapes we can't safely
        // mechanically rewrite (embedded \n, mid-template \n, etc.).
        for (const quasi of node.quasis) {
          const cooked = quasi.value?.cooked
          if (typeof cooked !== 'string' || !cooked.includes('\n')) {
            continue
          }
          reportFor(quasi, cooked, origMethod)
          return
        }
      },
    }
  },
}

export default rule
