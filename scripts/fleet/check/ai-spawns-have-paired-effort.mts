// Fleet check — every programmatic AI spawn that pins a model also pins effort.
//
// CLAUDE.md token-spend rule: "match model AND effort to the job." A spawn that
// sets a model but leaves reasoning effort at the session default is a cost
// leak in both directions — a cheap model on the session's default (often high)
// burns reasoning a mechanical rewrite never needs, and a premium model on the
// default low underthinks. The lib's `spawnAiAgent` accepts an `effort` field
// (`@socketsecurity/lib/ai/types` `AiEffort`) and translates it per-agent
// (claude `--effort`, codex `-c model_reasoning_effort=`); leaving it off is
// silently accepting whatever the CLI defaults to.
//
// Two shapes are scanned across the source tree (scripts + skills + hooks):
//   1. spawnAiAgent({ ... }) calls — the argument object names `model` but not
//      `effort`. (A spread profile like AI_PROFILE.edit never carries effort, so
//      the spread doesn't satisfy the pairing — the call must name effort.)
//   2. A hand-rolled backend runner argv that pushes a `--model` flag must also
//      push an effort flag (`--effort` for claude, `model_reasoning_effort=` for
//      codex). Backends with no effort flag (gemini / kimi / opencode — see
//      _shared/multi-agent-backends.md) are exempt.
//
// Why a check on top of the doc + the lib type: the lib makes effort OPTIONAL
// (correct — gemini/kimi ignore it), so the type system can't force the pairing
// at a claude/codex callsite. This gate is the enforcement layer the optional
// field can't provide.
//
// This check fails `check --all` when a scanned callsite pins a model without a
// paired effort. Exit codes: 0 — every model-pinning AI spawn pairs an effort;
// 1 — at least one does not.
//
// Usage: node scripts/fleet/check/ai-spawns-have-paired-effort.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { globSync } from '@socketsecurity/lib-stable/globs/match'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Source roots that may hold an AI-spawn callsite. Skill/script/hook code only;
// dist, node_modules, and fixtures are excluded by the glob ignore.
const SCAN_GLOBS = [
  'scripts/**/*.mts',
  '.claude/skills/**/*.mts',
  '.claude/hooks/**/*.mts',
] as const

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/*.test.mts',
  '**/test/**',
  // The check itself names the field strings it scans for.
  '**/check/ai-spawns-have-paired-effort.mts',
] as const

export interface EffortViolation {
  readonly file: string
  readonly line: number
  readonly detail: string
}

// Find the balanced-brace span of the object literal that opens at `start`
// (the index of its `{`). Returns the substring including both braces, or ''
// when unbalanced (truncated read / malformed source — skip rather than throw).
export function objectSpan(text: string, start: number): string {
  let depth = 0
  for (let i = start, { length } = text; i < length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return ''
}

// A spawnAiAgent({...}) call pins a model without pairing effort.
export function scanSpawnCalls(
  text: string,
): Array<{ index: number; detail: string }> {
  const hits: Array<{ index: number; detail: string }> = []
  const callRe = /spawnAiAgent\s*\(\s*\{/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(text))) {
    const braceAt = text.indexOf('{', m.index)
    if (braceAt < 0) {
      continue
    }
    const span = objectSpan(text, braceAt)
    if (!span) {
      continue
    }
    // Does the object literal contain a `model` / `effort` property KEY? Each
    // regex has three parts:
    //   (?:[\s,{]|^)  a boundary BEFORE the name — whitespace, a comma, the
    //                 opening brace, or start-of-span — so it matches the key
    //                 `model` but not a substring like `customModel`.
    //   model         the literal property name.
    //   \s*[:,}]      a boundary AFTER the name — optional spaces then `:`
    //                 (`model: x`), `,` (shorthand `model,`), or `}` (shorthand
    //                 `model}` as the last property). This is what lets the
    //                 check see both `model: foo` and the shorthand `model`.
    const hasModel = /(?:[\s,{]|^)model\s*[:,}]/.test(span)
    // Same key-boundary shape as the `model` probe above, for the `effort` key.
    const hasEffort = /(?:[\s,{]|^)effort\s*[:,}]/.test(span)
    if (hasModel && !hasEffort) {
      hits.push({
        index: m.index,
        detail:
          'spawnAiAgent({…}) sets `model` but not `effort`. Pair them — add `effort` (AiEffort) so the spawn pins reasoning level, not just the model.',
      })
    }
  }
  return hits
}

// A hand-rolled backend runner argv that pushes `--model` must also push an
// effort flag — but ONLY for the claude / codex backends. kimi / gemini /
// opencode have no reasoning-effort flag (see _shared/multi-agent-backends.md),
// so their `--model` push is legitimately effort-free and must NOT be flagged.
//
// Scoping: each backend's `run()` body is a small block. We decide a `--model`
// push belongs to claude/codex by the SAME-BLOCK presence of that backend's
// model env var (`CLAUDE_MODEL` / `CODEX_MODEL`) or `bin: 'claude'|'codex'`
// within a proximity window — not by a file-level claude/codex reference, which
// would wrongly implicate a kimi block sitting in the same file.
export function scanBackendArgv(
  text: string,
): Array<{ index: number; detail: string }> {
  const hits: Array<{ index: number; detail: string }> = []
  // Match the property-key / env-var that identifies a claude or codex backend
  // block: CLAUDE_MODEL / CODEX_MODEL, or a `bin: 'claude'|'codex'` literal.
  const CLAUDE_BLOCK_RE = /CLAUDE_MODEL|bin:\s*['"]claude['"]/
  // Same shape for the codex backend: the CODEX_MODEL env var OR a quoted
  // `bin: 'codex'` / `bin: "codex"` literal.
  const CODEX_BLOCK_RE = /CODEX_MODEL|bin:\s*['"]codex['"]/
  const modelFlagRe = /['"]--model['"]/g
  let m: RegExpExecArray | null
  while ((m = modelFlagRe.exec(text))) {
    // One backend's run() body fits in ~400 chars around the --model push.
    const around = text.slice(Math.max(0, m.index - 400), m.index + 400)
    const isClaudeBlock = CLAUDE_BLOCK_RE.test(around)
    const isCodexBlock = CODEX_BLOCK_RE.test(around)
    // kimi / gemini / opencode block → no effort flag expected → skip.
    if (!isClaudeBlock && !isCodexBlock) {
      continue
    }
    const pairedHere =
      (isClaudeBlock && /['"]--effort['"]/.test(around)) ||
      (isCodexBlock && /model_reasoning_effort=/.test(around))
    if (!pairedHere) {
      hits.push({
        index: m.index,
        detail:
          'A claude/codex backend runner pushes `--model` without a paired effort flag (`--effort` for claude, `-c model_reasoning_effort=` for codex). See _shared/multi-agent-backends.md.',
      })
    }
  }
  return hits
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') {
      line += 1
    }
  }
  return line
}

export function scanFile(repoRoot: string, rel: string): EffortViolation[] {
  const abs = path.join(repoRoot, rel)
  if (!existsSync(abs)) {
    return []
  }
  const text = readFileSync(abs, 'utf8')
  const out: EffortViolation[] = []
  const hits = [...scanSpawnCalls(text), ...scanBackendArgv(text)]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    out.push({ detail: hit.detail, file: rel, line: lineOf(text, hit.index) })
  }
  return out
}

export function scanRepo(repoRoot: string): EffortViolation[] {
  const files = globSync([...SCAN_GLOBS], {
    cwd: repoRoot,
    ignore: [...IGNORE_GLOBS],
  })
  const out: EffortViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    out.push(...scanFile(repoRoot, files[i]!))
  }
  return out
}

async function main(): Promise<void> {
  const violations = scanRepo(REPO_ROOT)
  if (violations.length) {
    logger.error(
      `AI spawns that pin a model without pairing effort (${violations.length}):`,
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(`  ${v.file}:${v.line} — ${v.detail}`)
    }
    logger.error(
      'CLAUDE.md token-spend: match model AND effort to the job. Pair every model-pinning claude/codex spawn with an effort. Vocab per backend: docs in .claude/skills/fleet/_shared/multi-agent-backends.md.',
    )
    process.exitCode = 1
    return
  }
  logger.success('Every model-pinning AI spawn pairs a reasoning effort.')
}

main().catch((e: unknown) => {
  logger.error(`check-ai-spawns-have-paired-effort failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
