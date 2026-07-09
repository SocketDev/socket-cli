#!/usr/bin/env node
// Claude Code PreToolUse hook — test-script-defers-guard.
//
// BLOCKS an Edit/Write/MultiEdit to a `package.json` that introduces a
// `test`/`test:*` script invoking a raw test-runner binary (`vitest`, `jest`,
// `mocha`, `ava`, `tap`, or a bare `node --test`) instead of deferring to a
// `.mts` wrapper (`node <path>.mts`).
//
// Why: the wrapper (`scripts/fleet/test.mts`) owns `--config` resolution,
// scope detection (`--staged`/`--changed`/`--all`/explicit files), and the
// pre-commit single-worker setting. A raw runner call in a package.json
// script bypasses all three, and a runner invoked against zero matching test
// files silently reports a green pass instead of failing loud. CLAUDE.md
// "Tests are vitest via…"; docs/agents.md/fleet/test-scripts-defer-to-mts.md.
//
// Exempt: the hook / lint-rule / git-hook tier's own package.json
// (`.claude/hooks/**`, `.config/fleet/oxlint-plugin/**`, `.git-hooks/**`)
// legitimately reads `"test": "node --test test/*.test.mts"` — that IS the
// `.mts`-routed form for that tier, not a violation.
//
// Detection: parses the INCOMING content of a package.json edit as JSON, then
// classifies each `test`/`test:*` script value via the AST shell-command
// parser (not a regex over the value, per no-hook-cmd-regex-guard). Does not
// compare with prior content — the check script
// (`test-scripts-are-deferred.mts`) covers the full-scan backlog; this guard
// blocks net-new introductions.
//
// Bypass: `Allow test-script-defers bypass` typed verbatim in a recent user
// turn.
//
// Exit codes: 0 pass, 2 block. Fails open on any error.

import path from 'node:path'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import type { Command } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const BYPASS_PHRASE = 'Allow test-script-defers bypass' as const

// `test` or `test:<anything>` — the fleet's test-script key surface.
// require-regex-comment: matches a package.json scripts key named `test` or `test:<suffix>`.
const TEST_SCRIPT_KEY_RE = /^test(?::.+)?$/

// Raw test-runner binaries banned outside the hook/lint-rule tier.
const RAW_RUNNER_BINARIES: ReadonlySet<string> = new Set([
  'ava',
  'jest',
  'mocha',
  'tap',
  'vitest',
])

// A compliant command: `node <path>.mts` (optionally followed by more args).
// Matched on the AST, not a regex, per no-hook-cmd-regex-guard.
function isMtsWrapper(cmd: Command): boolean {
  return (
    path.basename(cmd.binary) === 'node' && (cmd.args[0] ?? '').endsWith('.mts')
  )
}

// A raw runner: a bare vitest/jest/mocha/ava/tap binary, or `node ... --test`
// (the Node built-in runner, banned outside the hook/lint-rule tier).
function isRawRunner(cmd: Command): boolean {
  const base = path.basename(cmd.binary)
  return (
    RAW_RUNNER_BINARIES.has(base) ||
    (base === 'node' && cmd.args.includes('--test'))
  )
}

// Classify a script VALUE (the same shell-syntax shape as a live Bash
// command) via the AST parser — sees through `&&`/`;`/`|` chains the same way
// a live command would. The FIRST segment being the .mts wrapper is
// compliant regardless of what it internally spawns; any OTHER segment being
// a raw runner is a violation.
function isRawRunnerValue(value: string): boolean {
  const segments = parseCommands(value)
  if (segments.length === 0) {
    return false
  }
  if (isMtsWrapper(segments[0]!)) {
    return false
  }
  return segments.some(isRawRunner)
}

export function isPackageJson(filePath: string): boolean {
  return (
    (normalizePath(filePath).endsWith('/package.json') ||
      filePath === 'package.json') &&
    !normalizePath(filePath).includes('/node_modules/')
  )
}

// The hook / lint-rule / git-hook tier's canonical runner IS `node --test`
// (CLAUDE.md "Tests are vitest via…"); this guard never applies there.
export function isNodeTestTierPath(filePath: string): boolean {
  return (
    /(?:^|\/)\.claude\/hooks\//.test(filePath) ||
    /(?:^|\/)\.config\/fleet\/oxlint-plugin\//.test(filePath) ||
    /(?:^|\/)\.git-hooks\//.test(filePath)
  )
}

export interface RawRunnerFinding {
  readonly scriptKey: string
  readonly value: string
}

// Parses `content` as a package.json and returns the first `test*` script
// that invokes a raw runner directly, or undefined when the content doesn't
// parse, carries no scripts, or every `test*` script is compliant.
export function detectRawRunnerScript(
  content: string,
): RawRunnerFinding | undefined {
  let manifest: { scripts?: Record<string, unknown> | undefined }
  try {
    manifest = JSON.parse(content) as {
      scripts?: Record<string, unknown> | undefined
    }
  } catch {
    return undefined
  }
  const scripts = manifest.scripts
  if (!scripts || typeof scripts !== 'object') {
    return undefined
  }
  for (const [scriptKey, rawValue] of Object.entries(scripts)) {
    if (!TEST_SCRIPT_KEY_RE.test(scriptKey) || typeof rawValue !== 'string') {
      continue
    }
    if (isRawRunnerValue(rawValue)) {
      return { scriptKey, value: rawValue }
    }
  }
  return undefined
}

export const check = editGuard((filePath, content, payload) => {
  if (!isPackageJson(filePath) || isNodeTestTierPath(filePath)) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  const text = content ?? ''
  if (!text) {
    return undefined
  }
  const finding = detectRawRunnerScript(text)
  if (!finding) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      `[test-script-defers-guard] Blocked: \`"${finding.scriptKey}": "${finding.value}"\` invokes a raw test-runner binary directly.`,
      '',
      '  A package.json test script defers to a .mts wrapper — the wrapper owns',
      '  --config resolution, scope detection, and the pre-commit single-worker',
      '  setting; a raw vitest/jest/mocha/ava/tap (or bare `node --test` outside',
      '  the hook/lint-rule tier) bypasses all three.',
      '',
      '  Fix: route through the fleet-canonical wrapper:',
      `    "${finding.scriptKey}": "node scripts/fleet/test.mts"`,
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
      '',
      '  Reference: docs/agents.md/fleet/test-scripts-defer-to-mts.md',
    ].join('\n') + '\n',
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
