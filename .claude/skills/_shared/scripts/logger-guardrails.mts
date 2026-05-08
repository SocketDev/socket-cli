/**
 * Lint guardrails the fleet enforces beyond what oxlint covers natively.
 *
 * Five checks, one pass:
 *
 * 1. **Status-symbol emoji** (✓ ✔ ❌ ✗ ⚠ ⚠️ ❗ ✅ ❎ ☑) — banned.
 *    The `@socketsecurity/lib/logger` package owns the visual prefix
 *    via `logger.success()` / `logger.fail()` / `logger.warn()` etc.
 *    Hand-rolling the symbols fragments the visual style and bypasses
 *    theme-aware color.
 * 2. **`console.log` / `console.error` / `console.warn` / `console.info`
 *    / `console.debug` / `console.trace`** — banned. Use the logger.
 * 3. **Inline `getDefaultLogger().<method>()`** — banned. The logger
 *    must be hoisted at the top of the file:
 *      `const logger = getDefaultLogger()`
 *    then `logger.success(...)`. Inline calls re-resolve the logger
 *    every invocation and read inconsistently.
 * 4. **Dynamic `import()` in non-bundled code** — banned. Scripts under
 *    `scripts/` run directly via `node`; nothing bundles them, so a
 *    dynamic import only adds a runtime async hop for no resolution win.
 *    Use static ES6 imports. Allowed inside `src/` (which gets bundled)
 *    and inside `.config/` bundler configs.
 *
 * (TypeScript `any` is enforced by oxlint's `typescript/no-explicit-any`
 * rule — kept in `.oxlintrc.json` so it benefits from the language-aware
 * AST. Don't duplicate that here.)
 *
 * Why a custom check instead of oxlint plugins: the rules above need
 * either custom matchers (the inline-logger hoist requirement) or
 * conditional scope (dynamic-import bans only outside the bundled tree)
 * that oxlint's built-in rule set doesn't express. A small TS scanner
 * is cheaper than a full oxlint plugin and runs in the existing
 * scripts/check.mts pipeline.
 *
 * Usage:
 *   import { checkLoggerGuardrails } from '.../_shared/scripts/logger-guardrails.mts'
 *   const { violations } = await checkLoggerGuardrails({ cwd: process.cwd() })
 *   if (violations.length) { process.exitCode = 1 }
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import fastGlob from 'fast-glob'

export type GuardrailReason =
  | 'status-emoji'
  | 'console-call'
  | 'inline-logger'
  | 'dynamic-import'

export type GuardrailViolation = {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly snippet: string
  readonly reason: GuardrailReason
}

export type CheckLoggerGuardrailsOptions = {
  /** Repo root. Defaults to process.cwd(). */
  readonly cwd?: string
  /** Globs to scan, relative to cwd. */
  readonly include?: readonly string[]
  /** Globs to skip. */
  readonly exclude?: readonly string[]
  /** File extensions to scan. */
  readonly extensions?: readonly string[]
  /**
   * Globs that ARE bundled. Dynamic `import()` is allowed inside these
   * (the bundler resolves the import statically at build time). Default
   * is `src/**` + `.config/**` (bundler configs).
   */
  readonly bundledRoots?: readonly string[]
}

export type CheckLoggerGuardrailsResult = {
  readonly violations: readonly GuardrailViolation[]
  readonly fileCount: number
}

const DEFAULT_INCLUDE = ['scripts/**/*', 'src/**/*', 'lib/**/*', '.config/**/*']
const DEFAULT_EXCLUDE = [
  '**/dist/**',
  '**/node_modules/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/test/fixtures/**',
  '**/test/packages/**',
  '**/*.d.ts',
  '**/*.d.mts',
  '**/upstream/**',
]
const DEFAULT_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
const DEFAULT_BUNDLED_ROOTS = ['src/', '.config/']

const STATUS_EMOJI = ['✓', '✔', '❌', '✗', '⚠', '⚠️', '❗', '✅', '❎', '☑']

const CONSOLE_CALL_RE =
  /\bconsole\s*\.\s*(?:log|error|warn|info|debug|trace)\s*\(/g

const INLINE_LOGGER_RE = /\bgetDefaultLogger\s*\(\s*\)\s*\.\s*[a-zA-Z_$]/g

const DYNAMIC_IMPORT_RE = /(?<![a-zA-Z_$])import\s*\(/g

function isInBundledRoot(
  relativePath: string,
  bundledRoots: readonly string[],
): boolean {
  const normalized = relativePath.split(path.sep).join('/')
  return bundledRoots.some(root => normalized.startsWith(root))
}

function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  )
}

export async function checkLoggerGuardrails(
  options: CheckLoggerGuardrailsOptions = {},
): Promise<CheckLoggerGuardrailsResult> {
  const cwd = options.cwd ?? process.cwd()
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const bundledRoots = options.bundledRoots ?? DEFAULT_BUNDLED_ROOTS

  const files = await fastGlob(include as string[], {
    absolute: true,
    cwd,
    ignore: exclude as string[],
    onlyFiles: true,
  })

  const matched = files.filter(file =>
    extensions.some(ext => file.endsWith(ext)),
  )

  const violations: GuardrailViolation[] = []

  for (const file of matched) {
    if (!existsSync(file)) {
      continue
    }
    const relative = path.relative(cwd, file)
    const inBundled = isInBundledRoot(relative, bundledRoots)
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trimStart()
      if (isCommentLine(trimmed)) {
        continue
      }

      // (1) Status-symbol emoji.
      for (const emoji of STATUS_EMOJI) {
        const col = line.indexOf(emoji)
        if (col >= 0) {
          violations.push({
            column: col + 1,
            file: relative,
            line: index + 1,
            reason: 'status-emoji',
            snippet: line.trim(),
          })
          break
        }
      }

      // (2) console.* calls.
      CONSOLE_CALL_RE.lastIndex = 0
      const consoleMatch = CONSOLE_CALL_RE.exec(line)
      if (consoleMatch) {
        violations.push({
          column: consoleMatch.index + 1,
          file: relative,
          line: index + 1,
          reason: 'console-call',
          snippet: line.trim(),
        })
      }

      // (3) Inline getDefaultLogger().
      INLINE_LOGGER_RE.lastIndex = 0
      const inlineMatch = INLINE_LOGGER_RE.exec(line)
      if (inlineMatch) {
        violations.push({
          column: inlineMatch.index + 1,
          file: relative,
          line: index + 1,
          reason: 'inline-logger',
          snippet: line.trim(),
        })
      }

      // (4) Dynamic import in non-bundled code.
      if (!inBundled) {
        DYNAMIC_IMPORT_RE.lastIndex = 0
        const dynamicMatch = DYNAMIC_IMPORT_RE.exec(line)
        if (dynamicMatch) {
          violations.push({
            column: dynamicMatch.index + 1,
            file: relative,
            line: index + 1,
            reason: 'dynamic-import',
            snippet: line.trim(),
          })
        }
      }
    }
  }

  return { fileCount: matched.length, violations }
}

export const GUARDRAIL_FIX_HINTS: Readonly<Record<GuardrailReason, string>> = {
  'console-call':
    'Use logger from @socketsecurity/lib/logger: import { getDefaultLogger } from "@socketsecurity/lib/logger"; const logger = getDefaultLogger(); then logger.success(...) / logger.fail(...) / logger.warn(...) / logger.info(...) / logger.log(...).',
  'dynamic-import':
    "Use a static `import` statement at the top of the file. Dynamic `import()` is only allowed inside bundled code (src/ or bundler configs); script files run directly via `node` and don't need lazy resolution.",
  'inline-logger':
    'Hoist the logger: `const logger = getDefaultLogger()` near the top of the file. Inline `getDefaultLogger().<method>()` re-resolves on every call.',
  'status-emoji':
    'Remove the literal symbol and use the matching logger method: ✓/✔/✅ → logger.success(...), ❌/✗ → logger.fail(...), ⚠/⚠️ → logger.warn(...), ℹ → logger.info(...).',
}
