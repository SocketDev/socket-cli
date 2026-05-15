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
 * The rule does NOT autofix because (a) the original string may
 * carry other meaningful chars between the emoji and the rest of
 * the message, and (b) extra-argument shape (label + payload) makes
 * a generic rewrite fragile. The warning text names both the right
 * blank-line method (stream-matched) and the right semantic method
 * (emoji-matched).
 */

// stderr-bound methods (per Logger#getTargetStream). `log` is the
// only stdout-bound method; everything semantic + `error` go to
// stderr. Blank lines for these use `logger.error('')` so the
// blank-line + message land on the same stream.

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

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
// Mirrors @socketsecurity/lib/logger's LOG_SYMBOLS (the table built
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
    fixable: undefined,
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
     * logger.<origMethod>(...) call.
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

      context.report({
        node,
        messageId,
        data: {
          origMethod,
          semanticMethod: semanticMethod ?? origMethod,
          emoji: emoji ?? '',
          blankCall,
        },
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
        for (const quasi of node.quasis) {
          const cooked = quasi.value?.cooked
          if (typeof cooked !== 'string' || !cooked.includes('\n')) {
            continue
          }
          reportFor(quasi, cooked, origMethod)
          // One report per template is enough; the human sees the issue.
          return
        }
      },
    }
  },
}

export default rule
