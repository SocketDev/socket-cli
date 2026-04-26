#!/usr/bin/env node
// Claude Code PreToolUse hook — path-guard firewall.
//
// Mantra: 1 path, 1 reference.
//
// Blocks Edit/Write tool calls that would *construct* a multi-segment
// build/output path inline in a `.mts` or `.cts` file, instead of
// importing the constructed value from the canonical `paths.mts` (or a
// build-infra helper). This fires BEFORE the write lands; exit code 2
// makes Claude Code refuse the tool call so the diff never touches the
// repo. The model sees the rejection reason on stderr and retries with
// an import-based approach.
//
// What the hook checks (subset of the gate's rules — diff-local only):
//
//   Rule A — Multi-stage path construction: a `path.join(...)` call or
//   string-template that stitches together two or more "stage" segments
//   like `'Final'`, `'Release'`, `'Stripped'`, `'Compressed'`,
//   `'Optimized'`, `'Synced'`, `'wasm'`, `'downloaded'` together with
//   `'build'` / `'out'` / a mode (`'dev'`/`'prod'`) or platform-arch.
//   Outside a `paths.mts` file, this is always a violation: the
//   construction belongs in a helper, every consumer imports the
//   computed value.
//
//   Rule B — Cross-package traversal: `path.join(*, '..', '<sibling
//   package>', 'build', ...)` reaches into a sibling's build output
//   without going through its `exports`. Forces consumers to declare a
//   workspace dep and import the sibling's `paths.mts`. The R28 yoga/
//   ink bug — ink hand-building yoga's wasm path and missing the
//   `wasm/` segment — is exactly the failure mode this prevents.
//
// What the hook does NOT check (the gate handles repo-wide concerns):
//
//   Rule C — workflow YAML repetition (gate scans .yml files).
//   Rule D — comment-encoded paths (gate scans comments + JSDoc).
//   Rule F — same path reconstructed in multiple files (needs whole-
//   repo state).
//   Rule G — Makefile / Dockerfile / shell-script paths (different
//   tool, gate covers).
//
// Scope:
//
//   - Fires only on `Edit` and `Write` tool calls.
//   - Skips files NOT ending in `.mts` or `.cts`. TS path code lives
//     there; .ts/.mjs/.js sources in `additions/` have different
//     constraints per CLAUDE.md.
//   - Skips when the target itself is a `paths.mts` (canonical
//     constructor), the gate (`scripts/check-paths.mts`), or this hook
//     — those files legitimately enumerate stage segments.
//
// Control flow uses a `BlockError` thrown from check helpers so every
// short-circuit path goes through a single `process.exitCode = 2` drop
// at the top-level catch — no scattered `process.exit(2)` that can race
// with buffered stderr. The hook fails OPEN on its own bugs (exit 0 +
// log) so a bad deploy of the hook can't brick the session.

import process from 'node:process'

// "Stage" segments — appearing two or more in the same path.join /
// template literal is a Rule A violation. These come from
// build-infra/lib/constants.mts BUILD_STAGES plus their lowercase
// directory-name siblings used by some builders (yoga's `wasm/`,
// build-infra's `downloaded/`).
const STAGE_SEGMENTS = new Set([
  'Final',
  'Release',
  'Stripped',
  'Compressed',
  'Optimized',
  'Synced',
  'wasm',
  'downloaded',
])

// "Build-root" segments — at least one must be present together with a
// stage segment to confirm we're constructing a build output path
// rather than something coincidental. Example: `path.join(SRC,
// 'wasm', 'lib')` shouldn't fire (no build root); `path.join(PKG,
// 'build', 'wasm', 'out', 'Final')` should (build root + wasm + out +
// Final).
const BUILD_ROOT_SEGMENTS = new Set(['build', 'out'])

// Mode segments — appearing alongside stage + build-root tightens the
// match further. `'dev'` and `'prod'` alone are too generic; we count
// them as a confirming signal, not a trigger.
const MODE_SEGMENTS = new Set(['dev', 'prod', 'shared'])

// Sibling Socket-fleet packages whose build output is reached via
// `path.join(*, '..', '<name>', 'build', ...)`. Union of all packages
// across the Socket fleet — the hook is byte-identical via
// sync-scaffolding, so listing every fleet package keeps Rule B firing
// in any repo. When a new package joins the workspace, add it here
// and propagate via `node scripts/sync-scaffolding.mjs --all --fix`
// from socket-repo-template.
const KNOWN_SIBLING_PACKAGES = new Set([
  // socket-btm
  'binflate',
  'binject',
  'binpress',
  'bin-infra',
  'build-infra',
  'codet5-models-builder',
  'curl-builder',
  'iocraft-builder',
  'ink-builder',
  'libpq-builder',
  'lief-builder',
  'minilm-builder',
  'models',
  'napi-go',
  'node-smol-builder',
  'onnxruntime-builder',
  'opentui-builder',
  'stubs-builder',
  'ultraviolet-builder',
  'yoga-layout-builder',
  // socket-cli
  'cli',
  'package-builder',
  // socket-tui
  'core',
  'react',
  'renderer',
  'ultraviolet',
  'yoga',
  // socket-registry / ultrathink
  'acorn',
  'npm',
])

// File-path patterns that are exempt from the hook entirely. Edits to
// these files legitimately need to enumerate path segments.
const EXEMPT_FILE_PATTERNS: RegExp[] = [
  // Any paths.mts is the canonical constructor.
  /(^|\/)paths\.(mts|cts)$/,
  // The gate itself and this hook — both enumerate the patterns to
  // detect them.
  /scripts\/check-paths\.mts$/,
  /\.claude\/hooks\/path-guard\/index\.(mts|cts)$/,
  /\.claude\/hooks\/path-guard\/test\//,
  // Existing path-scanning gates that intentionally enumerate.
  /scripts\/check-consistency\.mts$/,
]

class BlockError extends Error {
  public readonly rule: string
  public readonly suggestion: string
  public readonly snippet: string
  constructor(rule: string, suggestion: string, snippet: string) {
    super(rule)
    this.name = 'BlockError'
    this.rule = rule
    this.suggestion = suggestion
    this.snippet = snippet.slice(0, 240) + (snippet.length > 240 ? '…' : '')
  }
}

const stdin = (): Promise<string> =>
  new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })

type ToolInput = {
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

const isInScope = (filePath: string): boolean => {
  if (!filePath) {
    return false
  }
  // Only inspect TypeScript-Module / CommonJS-Module sources. Per
  // the user's directive, allowlist by extension.
  if (!filePath.endsWith('.mts') && !filePath.endsWith('.cts')) {
    return false
  }
  return !EXEMPT_FILE_PATTERNS.some(re => re.test(filePath))
}

// Extract every `path.join(...)` and `path.resolve(...)` call from
// the diff and return its argument substring. Uses paren-balancing so
// deeply nested arguments like `path.join(getDir(child(x)), 'Final')`
// are captured correctly — a regex-only approach silently missed any
// argument with 2+ levels of nested parentheses.
const extractPathCalls = (
  source: string,
): Array<{ snippet: string; literals: string[] }> => {
  const calls: Array<{ snippet: string; literals: string[] }> = []
  const callRe = /\bpath\.(?:join|resolve)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(source)) !== null) {
    const callStart = m.index
    const argsStart = callRe.lastIndex
    let depth = 1
    let i = argsStart
    let inString: '"' | "'" | '`' | null = null
    while (i < source.length && depth > 0) {
      const ch = source[i]!
      if (inString) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === inString) {
          inString = null
        }
      } else {
        if (ch === '"' || ch === "'" || ch === '`') {
          inString = ch
        } else if (ch === '(') {
          depth += 1
        } else if (ch === ')') {
          depth -= 1
          if (depth === 0) {
            break
          }
        }
      }
      i += 1
    }
    if (depth !== 0) {
      continue
    }
    const args = source.slice(argsStart, i)
    const litRe = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    const literals: string[] = []
    let lit: RegExpExecArray | null
    while ((lit = litRe.exec(args)) !== null) {
      const value = lit[2]
      if (value !== undefined) {
        literals.push(value)
      }
    }
    calls.push({ snippet: source.slice(callStart, i + 1), literals })
    callRe.lastIndex = i + 1
  }
  return calls
}

const checkRuleA = (calls: ReturnType<typeof extractPathCalls>): void => {
  for (const call of calls) {
    const stages = call.literals.filter(l => STAGE_SEGMENTS.has(l))
    const buildRoots = call.literals.filter(l => BUILD_ROOT_SEGMENTS.has(l))
    const modes = call.literals.filter(l => MODE_SEGMENTS.has(l))
    // Trigger if: 2+ stage segments OR (1 stage + 1 build-root + 1 mode).
    // Both shapes indicate a hand-built build-output path.
    const twoStages = stages.length >= 2
    const stagePlusContext =
      stages.length >= 1 && buildRoots.length >= 1 && modes.length >= 1
    if (twoStages || stagePlusContext) {
      throw new BlockError(
        'A — multi-stage path constructed inline',
        'Construct this path in the owning `paths.mts` (or a build-infra helper like `getFinalBinaryPath`) and import the computed value here. 1 path, 1 reference.',
        call.snippet,
      )
    }
  }
}

const checkRuleB = (calls: ReturnType<typeof extractPathCalls>): void => {
  for (const call of calls) {
    // A sibling package name *immediately after* a `..` literal (no
    // path segment in between) plus build context elsewhere in the
    // call indicates cross-package traversal. The previous "sticky
    // sawDotDot" form fired falsely when '..' appeared early and an
    // unrelated sibling-named segment appeared much later.
    const hasBuildContext = call.literals.some(
      l => BUILD_ROOT_SEGMENTS.has(l) || STAGE_SEGMENTS.has(l),
    )
    if (!hasBuildContext) {
      continue
    }
    for (let i = 0; i < call.literals.length - 1; i++) {
      if (
        call.literals[i] === '..' &&
        KNOWN_SIBLING_PACKAGES.has(call.literals[i + 1]!)
      ) {
        const sibling = call.literals[i + 1]!
        throw new BlockError(
          'B — cross-package path traversal',
          `Don't reach into '${sibling}'s build output via \`..\`. Add \`${sibling}: workspace:*\` as a dep and import its \`paths.mts\` via the \`exports\` field. 1 path, 1 reference.`,
          call.snippet,
        )
      }
    }
  }
}

// Backtick template-literal detection. Path construction via
// `${buildDir}/out/Final/${binary}` follows the same shape as
// path.join() and constitutes the same Rule A violation. Placeholders
// (${...}) are stripped to a sentinel that won't match any segment
// set, so segments composed entirely of interpolation contribute
// nothing to the trigger.
const TEMPLATE_LITERAL_RE = /`((?:\\.|(?:\$\{(?:[^{}]|\{[^{}]*\})*\})|(?!`)[^\\])*)`/g

const checkRuleATemplate = (source: string): void => {
  TEMPLATE_LITERAL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEMPLATE_LITERAL_RE.exec(source)) !== null) {
    const body = m[1] ?? ''
    if (!body.includes('/')) {
      continue
    }
    const stripped = body.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '\x00')
    const segments = stripped
      .split('/')
      .filter(s => s.length > 0 && s !== '\x00')
    const stages = segments.filter(s => STAGE_SEGMENTS.has(s))
    const buildRoots = segments.filter(s => BUILD_ROOT_SEGMENTS.has(s))
    const modes = segments.filter(s => MODE_SEGMENTS.has(s))
    // Template literal trigger is tighter than path.join() because
    // backtick strings often appear in patch fixtures, error messages,
    // and other multi-line content that incidentally contains stage
    // tokens like `wasm`. Require the canonical build-output shape.
    const hasBuildAndOut =
      buildRoots.includes('build') && buildRoots.includes('out')
    const hasOut = buildRoots.includes('out')
    const hasBuild = buildRoots.includes('build')
    const triggers =
      (hasBuildAndOut && stages.length >= 1) ||
      (stages.length >= 2 && hasOut) ||
      (hasBuild && stages.length >= 1 && modes.length >= 1)
    if (triggers) {
      throw new BlockError(
        'A — multi-stage path constructed inline via template literal',
        'Construct this path in the owning `paths.mts` (or a build-infra helper) and import the computed value here. 1 path, 1 reference.',
        m[0],
      )
    }
  }
}

const check = (source: string): void => {
  const calls = extractPathCalls(source)
  if (calls.length > 0) {
    checkRuleA(calls)
    checkRuleB(calls)
  }
  checkRuleATemplate(source)
}

const emitBlock = (filePath: string, err: BlockError): void => {
  process.stderr.write(
    `\n[path-guard] Blocked: ${err.rule}\n` +
      `  Mantra: 1 path, 1 reference\n` +
      `  File:    ${filePath}\n` +
      `  Snippet: ${err.snippet}\n` +
      `  Fix:     ${err.suggestion}\n\n`,
  )
}

const main = async (): Promise<void> => {
  const raw = await stdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!isInScope(filePath)) {
    return
  }
  // Edit tool sends `new_string` (the replacement); Write sends
  // `content` (the full file). Either is the text we'd be putting on
  // disk.
  const source =
    payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
  if (!source) {
    return
  }

  try {
    check(source)
  } catch (e) {
    if (e instanceof BlockError) {
      emitBlock(filePath, e)
      process.exitCode = 2
      return
    }
    throw e
  }
}

main().catch(e => {
  // Never block a tool call due to a bug in the hook itself. Log it
  // so we notice, but fail open.
  process.stderr.write(`[path-guard] hook error (allowing): ${e}\n`)
  process.exitCode = 0
})
