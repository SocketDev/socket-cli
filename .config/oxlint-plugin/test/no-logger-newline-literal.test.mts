/**
 * @fileoverview Unit tests for socket/no-logger-newline-literal.
 */

/* oxlint-disable socket/no-status-emoji -- emoji literals in invalid-case
   inputs are the very shape this rule warns about; that's the test. */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/no-logger-newline-literal.mts'

describe('socket/no-logger-newline-literal', () => {
  test('valid: no newline in arg', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [
        { name: 'plain log', code: 'logger.log("Hello")\n' },
        { name: 'fail without newline', code: 'logger.fail("Build failed")\n' },
        { name: 'empty arg', code: 'logger.log("")\n' },
        { name: 'newline in non-logger call', code: 'foo.log("a\\nb")\n' },
        {
          name: 'newline in console (not logger.*)',
          code: 'console.log("a\\nb")\n',
        },
        {
          name: 'newline in non-tracked method',
          code: 'logger.indent("a\\nb")\n',
        },
        {
          name: 'template without newline',
          code: 'logger.log(`Hello ${name}`)\n',
        },
      ],
      invalid: [],
    })
  })

  test('invalid: leading newline rewrites with emoji map', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        {
          name: 'logger.error with leading \\n + ✗ → blank=error, msg=fail',
          code: 'logger.error("\\n✗ Build failed:", e)\n',
          errors: [{ messageId: 'leadingNewline' }],
        },
        {
          name: 'logger.log with leading \\n + ✓ → blank=log, msg=success',
          code: 'logger.log("\\n✓ Done")\n',
          errors: [{ messageId: 'leadingNewline' }],
        },
        {
          name: 'logger.log with leading \\n, no emoji → blank=log, msg=log',
          code: 'logger.log("\\nplain message")\n',
          errors: [{ messageId: 'leadingNewlineNoEmoji' }],
        },
      ],
    })
  })

  test('invalid: trailing newline rewrites', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        {
          name: 'logger.success with trailing \\n + ✓ → msg=success, blank=error',
          code: 'logger.success("✓ NAPI built\\n")\n',
          errors: [{ messageId: 'trailingNewline' }],
        },
        {
          name: 'logger.log with trailing \\n, no emoji',
          code: 'logger.log("plain\\n")\n',
          errors: [{ messageId: 'trailingNewlineNoEmoji' }],
        },
      ],
    })
  })

  test('invalid: embedded newline', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        {
          name: 'logger.log with mid-string \\n',
          code: 'logger.log("first line\\nsecond line")\n',
          errors: [{ messageId: 'embeddedNewline' }],
        },
      ],
    })
  })

  test('invalid: template literal with newline', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        {
          name: 'template trailing newline',
          code: 'logger.log(`out: ${name}\\n`)\n',
          errors: [{ messageId: 'trailingNewlineNoEmoji' }],
        },
        {
          name: 'template leading newline + emoji',
          code: 'logger.error(`\\n❌ ${msg}`)\n',
          errors: [{ messageId: 'leadingNewline' }],
        },
      ],
    })
  })

  test('emoji variants map correctly', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        // success variants
        { code: 'logger.log("✓ ok\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("✔ ok\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("✅ ok\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("√ ok\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        // fail variants
        { code: 'logger.log("✗ fail\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("❌ fail\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("✖ fail\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("× fail\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        // warn variants
        { code: 'logger.log("⚠ warn\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("🚨 warn\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("❗ warn\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
        { code: 'logger.log("‼ warn\\n")\n', errors: [{ messageId: 'trailingNewline' }] },
      ],
    })
  })

  test('anchored fallbacks: at start of string only', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [
        // `>` in middle = not a status symbol
        {
          name: '> mid-string is fine',
          code: 'logger.log("a > b\\n")\n',
        },
        // `i` in middle of a word
        {
          name: 'i in word is fine',
          code: 'logger.log("indexing items\\n")\n',
        },
        // `@` in middle (package ref)
        {
          name: '@ in package ref is fine',
          code: 'logger.log("scope @ name\\n")\n',
        },
      ],
      invalid: [
        // `→` at start IS a status symbol → step
        {
          name: '→ at start → step',
          code: 'logger.log("→ step done\\n")\n',
          errors: [{ messageId: 'trailingNewline' }],
        },
        // ASCII step `>` at start → step
        {
          name: '> at start → step',
          code: 'logger.log("> step done\\n")\n',
          errors: [{ messageId: 'trailingNewline' }],
        },
        // `↻` at start → skip
        {
          name: '↻ at start → skip',
          code: 'logger.log("↻ retry\\n")\n',
          errors: [{ messageId: 'trailingNewline' }],
        },
        // `∴` at start → progress
        {
          name: '∴ at start → progress',
          code: 'logger.log("∴ working\\n")\n',
          errors: [{ messageId: 'trailingNewline' }],
        },
        // anchored fallback after leading whitespace (logger strip
        // tolerates leading \n + symbol)
        {
          name: '\\n + → at start → step',
          code: 'logger.log("\\n→ step\\n")\n',
          errors: [{ messageId: 'leadingNewline' }],
        },
      ],
    })
  })

  test('no false positives: emoji-free strings with \\n', () => {
    new RuleTester().run('no-logger-newline-literal', rule, {
      valid: [],
      invalid: [
        // No emoji means we keep the original method, just split.
        {
          name: 'plain logger.error with \\n stays error',
          code: 'logger.error("\\nBuild failed:", e)\n',
          errors: [{ messageId: 'leadingNewlineNoEmoji' }],
        },
      ],
    })
  })
})
