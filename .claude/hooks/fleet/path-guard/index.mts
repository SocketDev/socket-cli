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
//   Rule A — Multi-stage path construction: a `path.join(...)` /
//   `path.resolve(...)` call or string-template that stitches together
//   two or more "stage" segments together with build / out / mode /
//   platform-arch context. Outside a `paths.mts` file this is a
//   violation: the construction belongs in a helper, every consumer
//   imports the computed value.
//
//   Rule B — Cross-package traversal: `path.join(*, '..', '<sibling
//   package>', 'build', ...)` reaches into a sibling's build output
//   without going through its `exports`. Forces consumers to declare a
//   workspace dep and import the sibling's `paths.mts`.
//
// What the hook does NOT check (the gate handles repo-wide concerns):
//
//   Rule C — workflow YAML repetition (gate scans .yml files).
//   Rule D — comment-encoded paths (gate scans comments + JSDoc).
//   Rule F — same path reconstructed in multiple files.
//   Rule G — Makefile / Dockerfile / shell-script paths.
//
// AST-based detector (vendored acorn-wasm). Replaces the prior
// regex+paren-balance string scanner that the previous file's
// `extractPathCalls` had to roll by hand because regex couldn't
// handle nested parens in argument lists like
// `path.join(getDir(x), 'Final')`. The AST visitor sees those calls
// natively, with arguments resolved as Literal / NewExpression /
// CallExpression / TemplateLiteral nodes; we only treat string-Literal
// arguments as path segments (every other shape is a computed value
// that doesn't participate in the rule).
//
// Scope:
//   - Fires only on `Edit` and `Write` tool calls.
//   - Only `.mts` / `.cts` source files.
//   - Skips `paths.mts` itself (canonical constructor) and the gate /
//     hook implementations that enumerate stage tokens.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log).

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findTemplateLiterals, walkSimple } from '../_shared/acorn/index.mts'
import type { AcornNode, TemplateLiteralSite } from '../_shared/acorn/index.mts'
import { withEditGuard } from '../_shared/payload.mts'
import {
  BUILD_ROOT_SEGMENTS,
  KNOWN_SIBLING_PACKAGES,
  MODE_SEGMENTS,
  STAGE_SEGMENTS,
} from './segments.mts'

const logger = getDefaultLogger()

const EXEMPT_FILE_PATTERNS: RegExp[] = [
  /(?:^|\/)paths\.(?:cts|mts)$/,
  /scripts\/check-paths\.mts$/,
  /scripts\/check-paths\//,
  /\.claude\/hooks\/(?:fleet\/)?path-guard\/index\.(?:cts|mts)$/,
  /\.claude\/hooks\/(?:fleet\/)?path-guard\/test\//,
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

export function isInScope(filePath: string) {
  if (!filePath) {
    return false
  }
  if (!filePath.endsWith('.mts') && !filePath.endsWith('.cts')) {
    return false
  }
  return !EXEMPT_FILE_PATTERNS.some(re => re.test(filePath))
}

interface PathCall {
  /**
   * All string-Literal arguments in source order.
   */
  literals: string[]
  /**
   * Whether ANY argument was a non-string node (Identifier / CallExpression /
   * etc.).
   */
  hasComputedArg: boolean
  /**
   * Source snippet around the call for the block message.
   */
  snippet: string
  /**
   * 1-based line of the call.
   */
  line: number
}

export function collectPathCalls(source: string): PathCall[] {
  const lines = source.split('\n')
  const out: PathCall[] = []
  // Match both `path.join(...)` and `path.resolve(...)` via two passes.
  for (const property of ['join', 'resolve']) {
    walkSimple(source, {
      CallExpression(node: AcornNode) {
        const callee = node['callee'] as AcornNode | undefined
        if (!callee || callee.type !== 'MemberExpression') {
          return
        }
        const obj = callee['object'] as AcornNode | undefined
        if (
          !obj ||
          obj.type !== 'Identifier' ||
          (obj['name'] as string) !== 'path'
        ) {
          return
        }
        const prop = callee['property'] as AcornNode | undefined
        if (
          !prop ||
          prop.type !== 'Identifier' ||
          (prop['name'] as string) !== property
        ) {
          return
        }
        const args = (node['arguments'] as AcornNode[] | undefined) ?? []
        const literals: string[] = []
        let hasComputedArg = false
        for (let i = 0, { length } = args; i < length; i += 1) {
          const a = args[i]!
          if (a.type === 'Literal' && typeof a['value'] === 'string') {
            literals.push(a['value'] as string)
          } else {
            hasComputedArg = true
          }
        }
        const start = node['start'] as number | undefined
        const end = node['end'] as number | undefined
        if (typeof start !== 'number' || typeof end !== 'number') {
          return
        }
        const line = source.slice(0, start).split('\n').length /* 1-based */
        const snippet = source.slice(start, end)
        const trimmedLine = lines[line - 1]?.trim() ?? ''
        out.push({
          literals,
          hasComputedArg,
          // Prefer the single-line text when the call fits on one
          // line; otherwise show the slice (truncated by BlockError).
          snippet: snippet.includes('\n') ? snippet : trimmedLine,
          line,
        })
      },
    })
  }
  return out
}

export function checkRuleA(calls: PathCall[]) {
  for (let i = 0, { length } = calls; i < length; i += 1) {
    const call = calls[i]!
    const stages = call.literals.filter(l => STAGE_SEGMENTS.has(l))
    const buildRoots = call.literals.filter(l => BUILD_ROOT_SEGMENTS.has(l))
    const modes = call.literals.filter(l => MODE_SEGMENTS.has(l))
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

export function checkRuleB(calls: PathCall[]) {
  for (let i = 0, { length } = calls; i < length; i += 1) {
    const call = calls[i]!
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

export function checkRuleATemplate(templates: TemplateLiteralSite[]) {
  for (let i = 0, { length } = templates; i < length; i += 1) {
    const tpl = templates[i]!
    // Skip templates with no `/` separator — they can't be path-shaped.
    if (!tpl.segments.includes('/')) {
      continue
    }
    // Replace `\0` expression sentinels with empty (they don't
    // contribute path segments); split on `/`; filter empty.
    const segments = tpl.segments
      .replace(/\x00/g, '')
      .split('/')
      .filter(s => s.length > 0)
    const stages = segments.filter(s => STAGE_SEGMENTS.has(s))
    const buildRoots = segments.filter(s => BUILD_ROOT_SEGMENTS.has(s))
    const modes = segments.filter(s => MODE_SEGMENTS.has(s))
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
        tpl.text,
      )
    }
  }
}

export function check(source: string) {
  const calls = collectPathCalls(source)
  if (calls.length > 0) {
    checkRuleA(calls)
    checkRuleB(calls)
  }
  const templates = findTemplateLiterals(source)
  if (templates.length > 0) {
    checkRuleATemplate(templates)
  }
}

export function emitBlock(filePath: string, err: BlockError) {
  logger.error(
    `\n[path-guard] Blocked: ${err.rule}\n` +
      `  Mantra: 1 path, 1 reference\n` +
      `  File:    ${filePath}\n` +
      `  Snippet: ${err.snippet}\n` +
      `  Fix:     ${err.suggestion}\n\n`,
  )
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content) => {
  if (!isInScope(filePath)) {
    return
  }
  const source = content ?? ''
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
})
