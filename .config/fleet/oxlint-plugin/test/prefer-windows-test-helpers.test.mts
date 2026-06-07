/**
 * @file Unit tests for socket/prefer-windows-test-helpers. The rule is opt-in
 *   by directory presence: it stays silent unless a `test/_shared/fleet/lib`
 *   directory exists at a walk-up ancestor of the linted test file. The
 *   RuleTester writes each fixture (and creates its parent dirs) into a shared
 *   tmp dir, so a fixture whose `filename` nests the helper subtree under a
 *   unique prefix (`optin-<n>/test/_shared/fleet/lib/foo.test.mts`) makes the
 *   helper dir materialize on that fixture's own walk-up path — turning the
 *   rule on for that case only. Cases that must stay silent use a
 *   `no-optin-<n>/` prefix with no helper subtree. Each case gets a unique
 *   prefix dir so the rule's module-level walk-up cache never serves a stale
 *   opt-in result across cases. The rule is `fixable: false`, so no `output`
 *   assertions.
 */

import { describe, test } from 'node:test'

import { RuleTester } from '../lib/rule-tester.mts'
import rule from '../rules/prefer-windows-test-helpers.mts'

// Place a fixture INSIDE an opt-in subtree so the rule's `test/_shared/fleet/lib`
// walk-up finds the (auto-created) helper dir. Each case gets a unique `<n>` so
// every fixture has a distinct ancestor chain — the rule caches walk-up results
// per directory at module scope, so reusing a prefix would leak opt-in state
// from one case into the next.
function optIn(n: string): string {
  return `optin-${n}/test/_shared/fleet/lib/foo.test.mts`
}

// A test file with NO helper subtree on its walk-up path — the rule returns `{}`
// early and emits nothing, no matter what the body contains.
function noOptIn(n: string): string {
  return `no-optin-${n}/foo.test.mts`
}

describe('socket/prefer-windows-test-helpers', () => {
  test('valid + invalid cases', () => {
    new RuleTester().run('prefer-windows-test-helpers', rule, {
      valid: [
        {
          name: 'no opt-in dir: small setTimeout is silent (rule off)',
          filename: noOptIn('a'),
          code: 'setTimeout(() => {}, 50)\n',
        },
        {
          name: 'no opt-in dir: skipIf(WIN32) is silent (rule off)',
          filename: noOptIn('b'),
          code: 'it.skipIf(WIN32)("x", () => {})\n',
        },
        {
          name: 'no opt-in dir: long per-test timeout is silent (rule off)',
          filename: noOptIn('c'),
          code: 'it("x", () => {}, 9000)\n',
        },
        {
          name: 'opt-in: non-test file (.mts, not .test/.spec) is exempt',
          filename: 'optin-d/test/_shared/fleet/lib/helper.mts',
          code: 'setTimeout(() => {}, 50)\n',
        },
        {
          name: 'opt-in: setTimeout delay 0 is not flagged (needs > 0)',
          filename: optIn('e'),
          code: 'setTimeout(() => {}, 0)\n',
        },
        {
          name: 'opt-in: setTimeout delay 201 is not flagged (> 200)',
          filename: optIn('f'),
          code: 'setTimeout(() => {}, 201)\n',
        },
        {
          name: 'opt-in: single-arg setTimeout (no delay) is not flagged',
          filename: optIn('g'),
          code: 'setTimeout(() => {})\n',
        },
        {
          name: 'opt-in: it() with no third-arg timeout is not flagged',
          filename: optIn('h'),
          code: 'it("x", () => {})\n',
        },
        {
          name: 'opt-in: per-test timeout 4999 is not flagged (< 5000)',
          filename: optIn('i'),
          code: 'it("x", () => {}, 4999)\n',
        },
        {
          name: 'opt-in: skipIf with a non-WIN32 arg is not flagged',
          filename: optIn('j'),
          code: 'it.skipIf(SOMETHING)("x", () => {})\n',
        },
        {
          name: 'opt-in: skipIf with more than one arg is not flagged',
          filename: optIn('k'),
          code: 'it.skipIf(WIN32, extra)("x", () => {})\n',
        },
        {
          name: 'opt-in: skipIf(WIN32) on a non-it/describe/test callee is not flagged',
          filename: optIn('l'),
          code: 'foo.skipIf(WIN32)("x", () => {})\n',
        },
        {
          name: 'opt-in: bare `socket-lint: allow` marker suppresses',
          filename: optIn('m'),
          code: 'setTimeout(() => {}, 50) // socket-lint: allow\n',
        },
        {
          name: 'opt-in: named `socket-lint: allow raw-windows-test` marker suppresses',
          filename: optIn('n'),
          code: 'setTimeout(() => {}, 50) // socket-lint: allow raw-windows-test\n',
        },
        {
          name: 'opt-in: oxlint-disable-next-line for this rule suppresses',
          filename: optIn('o'),
          code: '// oxlint-disable-next-line socket/prefer-windows-test-helpers\nsetTimeout(() => {}, 50)\n',
        },
      ],
      invalid: [
        {
          name: 'opt-in: setTimeout delay 1 (minimum) is flagged',
          filename: optIn('p'),
          code: 'setTimeout(() => {}, 1)\n',
          errors: [{ messageId: 'smallSleep' }],
        },
        {
          name: 'opt-in: setTimeout delay 200 (boundary) is flagged',
          filename: optIn('q'),
          code: 'setTimeout(() => {}, 200)\n',
          errors: [{ messageId: 'smallSleep' }],
        },
        {
          name: 'opt-in: it.skipIf(WIN32) is flagged',
          filename: optIn('r'),
          code: 'it.skipIf(WIN32)("x", () => {})\n',
          errors: [{ messageId: 'skipIfWindows' }],
        },
        {
          name: 'opt-in: describe.skipIf(WIN32) is flagged',
          filename: optIn('s'),
          code: 'describe.skipIf(WIN32)("x", () => {})\n',
          errors: [{ messageId: 'skipIfWindows' }],
        },
        {
          name: 'opt-in: test.skipIf(WIN32) is flagged',
          filename: optIn('t'),
          code: 'test.skipIf(WIN32)("x", () => {})\n',
          errors: [{ messageId: 'skipIfWindows' }],
        },
        {
          name: 'opt-in: it.skipIf(!WIN32) is flagged with the windows-only message',
          filename: optIn('u'),
          code: 'it.skipIf(!WIN32)("x", () => {})\n',
          errors: [{ messageId: 'skipIfNotWindows' }],
        },
        {
          name: 'opt-in: describe.skipIf(!WIN32) is flagged with the windows-only message',
          filename: optIn('v'),
          code: 'describe.skipIf(!WIN32)("x", () => {})\n',
          errors: [{ messageId: 'skipIfNotWindows' }],
        },
        {
          name: 'opt-in: it() per-test timeout 5000 (boundary) is flagged',
          filename: optIn('w'),
          code: 'it("x", () => {}, 5000)\n',
          errors: [{ messageId: 'longTimeout' }],
        },
        {
          name: 'opt-in: test() per-test timeout 10000 is flagged',
          filename: optIn('x'),
          code: 'test("x", () => {}, 10000)\n',
          errors: [{ messageId: 'longTimeout' }],
        },
      ],
    })
  })
})
