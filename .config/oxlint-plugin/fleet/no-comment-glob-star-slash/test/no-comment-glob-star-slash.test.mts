/**
 * @file Unit tests for socket/no-comment-glob-star-slash.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../../../lib/rule-tester.mts'
import rule from '../index.mts'

// The dangerous shape as AUTHORED is the escaped `**\/...` form — it parses
// (the backslash stops the `*/` from closing the comment) but oxfmt's jsdoc
// reflow unescapes it into a comment-closing `*/`. A RAW `**/` in a block
// comment would close the comment immediately, so a file containing it never
// parses and never reaches the linter; the realistic committed shape is escaped.
describe('socket/no-comment-glob-star-slash', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('no-comment-glob-star-slash', rule, {
      valid: [
        {
          name: 'block comment with no glob is fine',
          code: '/** just a normal description */\nexport const x = 1\n',
        },
        {
          name: 'line comment with an escaped glob is exempt (no closing token)',
          code: '// matches **\\/*.yml under any dir\nexport const x = 1\n',
        },
        {
          name: 'already backtick-split glob is fine (idempotent)',
          code: '/**\n * matches `**`/`*.yml` files\n */\nexport const x = 1\n',
        },
        {
          name: 'already backtick-split glob with trailing ** is fine',
          code: '/**\n * expands to `**`/`<dir>/**` here\n */\nexport const x = 1\n',
        },
        {
          name: 'plain path with no star-before-slash is fine',
          code: '/** path lib/soak-policy.mts is plain */\nexport const x = 1\n',
        },
        {
          name: 'bare ** with no following slash is fine',
          code: '/** a recursive ** wildcard alone */\nexport const x = 1\n',
        },
      ],
      invalid: [
        {
          name: 'escaped **\\/*.yml in a block comment is flagged + fixed',
          code: '/**\n * see **\\/*.yml files\n */\nexport const x = 1\n',
          errors: [{ messageId: 'globStarSlash' }],
          output: '/**\n * see `**`/`*.yml` files\n */\nexport const x = 1\n',
        },
        {
          name: 'escaped **\\/Dockerfile* is flagged + fixed',
          code: '/**\n * walk **\\/Dockerfile* digests\n */\nexport const x = 1\n',
          errors: [{ messageId: 'globStarSlash' }],
          output:
            '/**\n * walk `**`/`Dockerfile*` digests\n */\nexport const x = 1\n',
        },
        {
          name: 'single-star packages/*\\/docker is flagged + fixed',
          code: '/** under packages/*\\/docker dirs */\nexport const x = 1\n',
          errors: [{ messageId: 'globStarSlash' }],
          output: '/** under packages/`*`/`docker` dirs */\nexport const x = 1\n',
        },
        {
          name: 'glob with trailing ** is fully fixed',
          code: '/**\n * expands to **\\/<dir>/** in the splice\n */\nexport const x = 1\n',
          errors: [{ messageId: 'globStarSlash' }],
          output:
            '/**\n * expands to `**`/`<dir>/**` in the splice\n */\nexport const x = 1\n',
        },
        {
          name: 'two globs in one comment are both fixed',
          code: '/** a **\\/b and **\\/c two */\nexport const x = 1\n',
          errors: [{ messageId: 'globStarSlash' }],
          output: '/** a `**`/`b` and `**`/`c` two */\nexport const x = 1\n',
        },
      ],
    })
  })
})
