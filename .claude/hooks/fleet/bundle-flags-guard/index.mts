// Claude Code PreToolUse hook — bundle-flags-guard.
//
// Blocks Edit/Write operations that flip `sourceMap`, `declarationMap`,
// `sourcemap`, or `minify` to `true` in shipped-build configs:
//
//   - `tsconfig.json` (any depth)
//   - `esbuild.config.{mts,ts,js,mjs,cjs}`
//   - `rolldown.config.{mts,ts,js,mjs,cjs}`
//   - `tsdown.config.{mts,ts,js,mjs,cjs}`
//   - `tsup.config.{mts,ts,js,mjs,cjs}`
//
// Fleet ships readable, map-free bundles: source maps leak source
// paths + bloat artifacts; minification obscures stack traces +
// complicates security review.
//
// The hook fires only on *transitions* (false / absent → true).
// Reverting true → false never blocks. Files already at true on disk
// can't be touched without first writing the bad state, so the
// bypass exists for that case.
//
// Test-only configs under test/ or __tests__/ are skipped — those don't ship.
//
// Bypass: `Allow bundle-flags bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / regex errors.

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

// Bundler config filenames the hook scrutinizes. Match basename only;
// `*.config.ts` style files live wherever the package author put them.
const BUNDLER_CONFIG_RE =
  /^(?:esbuild|rolldown|tsdown|tsup)\.config\.(?:mts|ts|js|mjs|cjs)$/

// Test-tree exclusions — these aren't shipped, so flipping flags is
// harmless. `__tests__` is the Jest convention; fleet uses `test/`
// but some packages keep both.
const TEST_TREE_RE = /(?:^|\/)(?:test|tests|__tests__)\//

// Bundler-config patterns: regex over the after-text. Configs are JS,
// not JSON, so a full parse would need a JS engine. Regex is precise
// enough — these tokens only appear as object keys at the call sites
// we care about, and the test-tree exclusion catches false matches in
// test fixtures.
//
// Matches: `sourcemap: true`, `sourcemap:true`, `"sourcemap": true`,
// `sourcemap: 'inline'`, `sourcemap: "external"`. Does NOT match
// `sourcemap: false` (the desired state) or `// sourcemap: true` (a
// comment) or `*sourcemap: true*` (markdown).
const BAD_SOURCEMAP_RE =
  /(?<![\w/])(?:['"]?sourcemap['"]?)\s*:\s*(?:true|['"](?:inline|external|linked|both)['"])/i
const BAD_MINIFY_RE = /(?<![\w/])(?:['"]?minify['"]?)\s*:\s*true(?!\w)/i

interface FindingDetail {
  readonly key: string
  readonly line: number
  readonly source: string
}

export function isBundlerConfig(filePath: string): boolean {
  return BUNDLER_CONFIG_RE.test(path.basename(filePath))
}

export function isTsconfig(filePath: string): boolean {
  return path.basename(filePath) === 'tsconfig.json'
}

export function isTestTree(filePath: string): boolean {
  return TEST_TREE_RE.test(normalizePath(filePath))
}

// Read a top-level boolean from `compilerOptions` in a tsconfig.json
// text. Returns undefined when the file isn't parseable JSON (which
// happens often — tsconfig.json supports JSONC, comments and trailing
// commas, and the project shouldn't use a JSON parser strict enough
// to reject those). When JSON parse fails, the caller treats the
// before/after as equal (no transition) and the hook falls open.
export function readTsconfigFlag(
  jsonText: string,
  key: 'sourceMap' | 'declarationMap',
): boolean | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(jsonText))
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const co = (parsed as { compilerOptions?: unknown | undefined })
    .compilerOptions
  if (!co || typeof co !== 'object') {
    return undefined
  }
  const v = (co as Record<string, unknown>)[key]
  return typeof v === 'boolean' ? v : undefined
}

// Strip line + block comments from a JSON text so JSON.parse can read
// tsconfig.json files written in JSONC. Leaves strings intact (a `//`
// inside a string literal stays). Not a full JSONC parser — good
// enough for the flags this hook reads.
export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  let stringChar = ''
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\' && next !== undefined) {
        out += next
        i += 2
        continue
      }
      if (ch === stringChar) {
        inString = false
      }
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      inString = true
      stringChar = ch
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      const eol = text.indexOf('\n', i)
      i = eol === -1 ? text.length : eol
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

// Find bundler-config flag violations introduced by the edit. Compares
// pre- and post-edit text line-by-line: a violation pattern that
// exists in `after` but not in `before` is a regression. Comments
// inside the after-text are stripped before matching.
export function findBundlerViolations(
  before: string,
  after: string,
): FindingDetail[] {
  const beforeLines = new Set(before.split('\n').map(stripLineComment))
  const afterLines = after.split('\n')
  const out: FindingDetail[] = []
  for (let i = 0; i < afterLines.length; i += 1) {
    /* c8 ignore next */ const raw = afterLines[i] ?? ''
    const line = stripLineComment(raw)
    if (beforeLines.has(line)) {
      continue
    }
    if (BAD_SOURCEMAP_RE.test(line)) {
      out.push({ key: 'sourcemap', line: i + 1, source: raw.trim() })
    }
    if (BAD_MINIFY_RE.test(line)) {
      out.push({ key: 'minify', line: i + 1, source: raw.trim() })
    }
  }
  return out
}

function stripLineComment(line: string): string {
  let inString = false
  let stringChar = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (inString) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === stringChar) {
        inString = false
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '/' && next === '/') {
      return line.slice(0, i)
    }
  }
  return line
}

export const hook = defineHook({
  bypass: ['bundle-flags'],
  check: editGuard((filePath, _content, payload) => {
    if (isTestTree(filePath)) {
      return undefined
    }
    const tsconfig = isTsconfig(filePath)
    const bundler = isBundlerConfig(filePath)
    if (!tsconfig && !bundler) {
      return undefined
    }

    const currentText = safeReadFileSync(filePath) ?? ''
    const afterText = resolveEditedText(payload)
    if (afterText === undefined) {
      return undefined
    }

    const findings: FindingDetail[] = []
    if (tsconfig) {
      for (const key of ['sourceMap', 'declarationMap'] as const) {
        const before = readTsconfigFlag(currentText, key)
        const after = readTsconfigFlag(afterText, key)
        if (after === true && before !== true) {
          findings.push({ key, line: 0, source: `"${key}": true` })
        }
      }
    } else {
      findings.push(...findBundlerViolations(currentText, afterText))
    }

    if (findings.length === 0) {
      return undefined
    }

    const lines: string[] = [
      '[bundle-flags-guard] Blocked: shipped-build flag flipped to true',
      '',
      `  File: ${filePath}`,
      '',
    ]
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      const loc = f.line > 0 ? ` (line ${f.line})` : ''
      lines.push(`  • \`${f.key}\`${loc}: ${f.source}`)
    }
    lines.push(
      '',
      '  Shipped bundles must not emit source maps, declaration maps,',
      '  or minified output. Maps leak source paths and bloat artifacts;',
      '  minification obscures stack traces and complicates security review.',
      '',
      '  Fix: set the flag to `false` (or remove it — `false` is the default',
      '  for fleet packages).',
    )
    return block(lines.join('\n'))
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
