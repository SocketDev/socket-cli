/**
 * @file Encourage the canonical Windows-tolerance test helpers when a repo has
 *   opted in by carrying `test/_shared/fleet/` (cascaded from
 *   `socket-wheelhouse/template/test/_shared/fleet/`). The `_shared/` prefix
 *   tells vitest's `test/**\/*.test.*` include pattern (and any grep-based
 *   walker) that the contents are scaffolding, not tests. The three modules:
 *
 *   - `platform.mts` — `WIN32`, `NATIVE_PATH_SEP`, `windowsExe(name)`, and a
 *     `normalizePath` re-export.
 *   - `timing.mts` — `tolerantTimeout(ms)` / `tolerantSleep(ms)` (5× on Windows),
 *     `minTimerQuantum(ms)`, `TIMEOUT_MULTIPLIER`, `MIN_TIMER_QUANTUM_MS`.
 *   - `tags.mts` — `taggedFlaky` / `taggedWindows` / `taggedUnix` title-prefix
 *     helpers. This rule is **opt-in by directory presence**. Repos without
 *     `test/_shared/fleet/` see no warnings — pulling in the cascade turns the
 *     rule on. That avoids the chicken-and-egg problem of cascading a rule to a
 *     repo before its scaffolding catches up. Flags (only when
 *     `test/_shared/fleet/` exists at a walk-up ancestor):
 *
 *   1. `setTimeout(<cb>, N)` with `N ≤ 200` in a test file — small-delay sleeps
 *      are exactly the pattern that flakes on Windows. Suggest
 *      `tolerantSleep(N)` (settle/await shape) or `minTimerQuantum(N)`
 *      (hard-quantum shape) from `test/_shared/fleet/lib/timing.mts`.
 *   2. `it.skipIf(WIN32)(...)` / `describe.skipIf(WIN32)(...)` — replace with the
 *      named `itUnixOnly` / `describeUnixOnly` wrapper from the per-repo
 *      `test/util/skip-helpers.mts`.
 *   3. `it.skipIf(!WIN32)(...)` / `describe.skipIf(!WIN32)(...)` — same, but
 *      `itWindowsOnly` / `describeWindowsOnly`.
 *   4. Per-test timeout literal `≥ 5000` in the third positional arg of `it(...)`
 *      / `test(...)` — suggest `tolerantTimeout(N)` so the Windows leg gets the
 *      multiplier. Per-line opt-out: `// socket-hook: allow raw-windows-test`
 *      or `// oxlint-disable-next-line socket/prefer-windows-test-helpers`.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

// Fleet helpers live under `test/_shared/fleet/lib/` (cascaded from
// socket-wheelhouse/template). A repo opts in by having that directory
// present — `_shared/` instantly signals "no tests in here, just scaffolding"
// so vitest's `test/**/*.test.*` include pattern won't pick anything up.
// The cascade is atomic: if `lib/` exists, the full module set is there too,
// so a single directory-existence check suffices.
const HELPER_DIR_PATH = 'test/_shared/fleet/lib'

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const SMALL_SLEEP_MAX_MS = 200
const LONG_TIMEOUT_MIN_MS = 5_000
const SOCKET_HOOK_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

// Cache the opt-in result per ancestor directory so we don't re-stat for
// every test file. The cascade is atomic: if the helper directory exists at
// any walk-up ancestor, the full module set is there too.
const helperFileCache = new Map<string, boolean>()

function findHelperFile(testFilePath: string): boolean {
  let dir = path.dirname(testFilePath)
  const seen: string[] = []
  while (true) {
    seen.push(dir)
    if (helperFileCache.has(dir)) {
      const cached = helperFileCache.get(dir)!
      for (const d of seen) {
        helperFileCache.set(d, cached)
      }
      return cached
    }
    if (existsSync(path.join(dir, HELPER_DIR_PATH))) {
      for (const d of seen) {
        helperFileCache.set(d, true)
      }
      return true
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      for (const d of seen) {
        helperFileCache.set(d, false)
      }
      return false
    }
    dir = parent
  }
}

function isLineMarkered(line: string): boolean {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  return !m[1] || m[1] === 'raw-windows-test'
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use the Windows-tolerance test helpers from `test/_shared/fleet/` instead of raw `setTimeout`, `skipIf(WIN32)`, or long per-test timeout literals. Rule is silent when the helper directory does not exist.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: false,
    messages: {
      smallSleep:
        "`setTimeout(_, {{ms}})` in a test sleeps below Windows's 15.6 ms timer quantum and will round up unpredictably. Use `tolerantSleep({{ms}})` or `minTimerQuantum({{ms}})` from `test/_shared/fleet/lib/timing.mts`.",
      skipIfWindows:
        '`it/describe.skipIf(WIN32)(...)` is the raw form. Use `itUnixOnly` / `describeUnixOnly` from `test/util/skip-helpers.mts` so the skip reason is in the helper name.',
      skipIfNotWindows:
        '`it/describe.skipIf(!WIN32)(...)` is the raw form. Use `itWindowsOnly` / `describeWindowsOnly` from `test/util/skip-helpers.mts`.',
      longTimeout:
        'Per-test timeout literal `{{ms}}` does not adapt for the 5× multiplier Windows needs. Use `tolerantTimeout({{ms}})` from `test/_shared/fleet/lib/timing.mts`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename: string = context.getFilename
      ? context.getFilename()
      : (context.filename ?? '')
    // Only fire on test files.
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    // Only fire when the repo opted in by providing the helpers file.
    if (!findHelperFile(filename)) {
      return {}
    }
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const lines: string[] = sourceCode.lines ?? []

    function lineFor(node: AstNode): string {
      const idx = (node.loc?.start?.line ?? 1) - 1
      return lines[idx] ?? ''
    }

    return {
      CallExpression(node: AstNode) {
        if (isLineMarkered(lineFor(node))) {
          return
        }
        const callee = node.callee
        if (!callee) {
          return
        }
        // setTimeout(cb, N) with N ≤ 200 — flag.
        if (
          callee.type === 'Identifier' &&
          callee.name === 'setTimeout' &&
          Array.isArray(node.arguments) &&
          node.arguments.length >= 2
        ) {
          const delay = node.arguments[1]
          if (
            delay &&
            delay.type === 'Literal' &&
            typeof delay.value === 'number' &&
            delay.value > 0 &&
            delay.value <= SMALL_SLEEP_MAX_MS
          ) {
            context.report({
              node: delay,
              messageId: 'smallSleep',
              data: { ms: String(delay.value) },
            })
          }
        }
        // it.skipIf(WIN32) / describe.skipIf(WIN32) / it.skipIf(!WIN32) /
        // describe.skipIf(!WIN32) — flag with the appropriate suggestion.
        if (
          callee.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'skipIf' &&
          callee.object?.type === 'Identifier' &&
          (callee.object.name === 'it' ||
            callee.object.name === 'describe' ||
            callee.object.name === 'test') &&
          Array.isArray(node.arguments) &&
          node.arguments.length === 1
        ) {
          const arg = node.arguments[0]
          if (arg?.type === 'Identifier' && arg.name === 'WIN32') {
            context.report({ node, messageId: 'skipIfWindows' })
          } else if (
            arg?.type === 'UnaryExpression' &&
            arg.operator === '!' &&
            arg.argument?.type === 'Identifier' &&
            arg.argument.name === 'WIN32'
          ) {
            context.report({ node, messageId: 'skipIfNotWindows' })
          }
        }
        // it(name, fn, NNN) / test(name, fn, NNN) — per-test timeout literal.
        // Flag when NNN >= 5000 (anything below that is reasonable as-is on
        // Unix; >= 5s suggests the author already widened for Windows).
        if (
          callee.type === 'Identifier' &&
          (callee.name === 'it' || callee.name === 'test') &&
          Array.isArray(node.arguments) &&
          node.arguments.length >= 3
        ) {
          const timeout = node.arguments[2]
          if (
            timeout &&
            timeout.type === 'Literal' &&
            typeof timeout.value === 'number' &&
            timeout.value >= LONG_TIMEOUT_MIN_MS
          ) {
            context.report({
              node: timeout,
              messageId: 'longTimeout',
              data: { ms: String(timeout.value) },
            })
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
