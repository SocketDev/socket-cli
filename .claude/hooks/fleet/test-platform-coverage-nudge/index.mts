#!/usr/bin/env node
// Claude Code PreToolUse hook — test-platform-coverage-nudge.
//
// Nudges when a test edit asserts a platform-specific path layout
// (`bin/python3`, `python.exe`, `.exe`, etc.) without gating on
// `process.platform` / `WIN32`. Saw this in socket-lib's Windows CI:
// `python from-download — pythonFromDownload > honors a cacheDir
// override for the extraction dir` hard-coded `/custom/py/python/bin/
// python3` and failed on Windows because `pythonBinPath` correctly
// returns `python.exe` there. The implementation was right; the test
// expectation was POSIX-only.
//
// Trigger surface (test files only, by path):
//   test/**/*.test.{ts,mts,js,mjs} | tests/**/*.test.* | __tests__/**/*.test.*
// Plus the content carrying a known platform-divergent path token but
// no `process.platform` / `WIN32` / `os.platform()` branch in the same
// edit.
//
// Stderr reminder; never blocks.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// Match a test file path: a `test/`, `tests/`, or `__tests__/` directory
// segment at any depth, followed by any filename ending in `.test.` or
// `.spec.` and a JS/TS extension (js, ts, mjs, mts, cjs, cts, jsx, tsx).
const TEST_FILE_RE =
  /(?:^|[\\/])(?:test|tests|__tests__)[\\/].+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u

// Path tokens that diverge between POSIX and Windows. Hitting any of
// these in an assertion suggests the test will pick the wrong layout
// when run on the other platform.
// The original list included `bin/node`, `bin/npm`, `bin/pnpm`,
// `bin/yarn` — but those tokens appear in unrelated tests (pnpm
// install footers, node_modules/.bin fixtures) and trip the reminder
// without any actual platform divergence in the assertion. The actual
// motivator (socket-lib's pythonBinPath Windows test) hinges on the
// .exe / bin/python3 split. Restrict to tokens that are GENUINELY
// platform-divergent in path resolution: Python's bin/python3 ↔
// python.exe split, generic `.exe` suffixes, and absolute paths
// keyed off a POSIX `/bin/` or Windows drive letter.
const PLATFORM_DIVERGENT_RE =
  /\b(?:bin\/python3?|python\.exe|node\.exe|[a-z0-9_-]+\.exe\b|\\\\(?:Program Files|Users)|C:\\\\|\/usr\/(?:local\/)?bin\/(?:python3?|node|sh)\b|\/bin\/sh\b)/u

// Markers that say the test IS already platform-aware. If any of these
// appear in the content, stay silent — the author considered Windows.
const PLATFORM_GATE_RE =
  /(?:process\.platform|os\.platform\(\)|WIN32\b|isWindows\b|isWin32\b|describe\.skipIf|it\.skipIf|test\.skipIf|describeWindows|describeUnix)/u

function shouldRemind(filePath: string, content: string | undefined): boolean {
  if (!content) {
    return false
  }
  if (!TEST_FILE_RE.test(normalizePath(filePath))) {
    return false
  }
  if (!PLATFORM_DIVERGENT_RE.test(content)) {
    return false
  }
  if (PLATFORM_GATE_RE.test(content)) {
    return false
  }
  return true
}

export const check = editGuard((filePath, content) => {
  if (!shouldRemind(filePath, content)) {
    return undefined
  }
  return notify(
    [
      `[test-platform-coverage-nudge] ${filePath}: test asserts a`,
      '  platform-divergent path token (e.g. `bin/python3`, `python.exe`,',
      '  `\\Program Files\\…`, `/usr/local/bin/…`) without a',
      '  `process.platform` / `WIN32` branch.',
      '',
      '  Windows CI typically returns the .exe / drive-letter layout;',
      '  POSIX runners return /bin/<name>. Hard-coding one side fails on',
      '  the other.',
      '',
      '  Fix patterns:',
      '    - Branch on the platform:',
      '        const expected = process.platform === "win32"',
      '          ? "C:\\\\…\\\\python.exe"',
      '          : "/…/bin/python3"',
      '        expect(result.path).toBe(expected)',
      '    - Skip the test on the unsupported platform:',
      "        describe.skipIf(process.platform === 'win32')(...)",
      '    - Use the fleet path-normalizer if the assertion is about a',
      '      path the implementation already platformized.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
