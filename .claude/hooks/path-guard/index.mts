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

const extractPathJoinArgs = (
  source: string,
): Array<{ snippet: string; literals: string[] }> => {
  // Match `path.join(...)` calls and capture the comma-separated
  // argument list. We're not parsing JS — a regex is brittle, but the
  // hook is a fast advisory line of defense and the gate runs a more
  // thorough whole-repo check at commit time.
  const calls: Array<{ snippet: string; literals: string[] }> = []
  const callRe = /\bpath\.join\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g
  let match: RegExpExecArray | null
  while ((match = callRe.exec(source)) !== null) {
    const args = match[1]
    if (args === undefined) {
      continue
    }
    // Pull out string literals from the arg list. Both single and
    // double quotes; ignore template-literal interpolations.
    const litRe = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    const literals: string[] = []
    let lit: RegExpExecArray | null
    while ((lit = litRe.exec(args)) !== null) {
      const value = lit[2]
      if (value !== undefined) {
        literals.push(value)
      }
    }
    calls.push({ snippet: match[0], literals })
  }
  return calls
}

const checkRuleA = (calls: ReturnType<typeof extractPathJoinArgs>): void => {
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

const checkRuleB = (calls: ReturnType<typeof extractPathJoinArgs>): void => {
  for (const call of calls) {
    // Look for the sequence: `..` then a known sibling package name
    // somewhere in the literal list. The literals come in order from
    // the regex, so a sibling appearing AFTER a `..` segment indicates
    // cross-package traversal.
    let sawDotDot = false
    for (const lit of call.literals) {
      if (lit === '..') {
        sawDotDot = true
        continue
      }
      if (sawDotDot && KNOWN_SIBLING_PACKAGES.has(lit)) {
        // Only fire when build-output context appears (otherwise this
        // could be a legitimate test fixture path or shared resource).
        const hasBuildContext = call.literals.some(
          l => BUILD_ROOT_SEGMENTS.has(l) || STAGE_SEGMENTS.has(l),
        )
        if (hasBuildContext) {
          throw new BlockError(
            'B — cross-package path traversal',
            `Don't reach into '${lit}'s build output via \`..\`. Add \`${lit}: workspace:*\` as a dep and import its \`paths.mts\` via the \`exports\` field. 1 path, 1 reference.`,
            call.snippet,
          )
        }
      }
    }
  }
}

const check = (source: string): void => {
  const calls = extractPathJoinArgs(source)
  if (calls.length === 0) {
    return
  }
  checkRuleA(calls)
  checkRuleB(calls)
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
