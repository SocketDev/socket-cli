// Fleet check — every programmatic AI spawn pins BOTH model and effort, and any
// escalation above the floor (cheapest model / lowest effort) carries a comment.
//
// CLAUDE.md token-spend rule: "match model AND effort to the job." A spawn that
// leaves either field at the session default is a cost leak in both directions —
// a cheap model on the session's default (often high) burns reasoning a
// mechanical rewrite never needs, and a premium model on the default low
// underthinks. The lib's `spawnAiAgent` makes both `model` and `effort` OPTIONAL
// (`@socketsecurity/lib/ai/types`) and translates effort per-agent (claude
// `--effort`, codex `-c model_reasoning_effort=`); leaving either off silently
// accepts whatever the CLI defaults to. So the gate is: name both, every time.
//
// The floor is the cheapest model (`claude-haiku-4-5`, per
// scripts/fleet/constants/model-pricing.json) and the lowest effort (`low`).
// That floor is the DEFAULT a spawn should pick. Spending above it — a pricier
// model literal or an effort literal above `low` — is a real cost decision, so
// it must be justified by an adjacent comment (inside the call's object literal
// or on the lines immediately preceding the call). A spawn whose model/effort
// come from a constant or an options field (`opts.updateModel`, `EFFORT`) can't
// be floor-checked statically, so only the pin-both rule applies there — the
// justification rule fires only on a literal escalation we can see.
//
// Shapes scanned across the source tree (scripts + skills + hooks + workflows):
//   1. spawnAiAgent({ ... }) / Workflow agent(prompt, { ... }) calls — the
//      argument object must name BOTH `model` and `effort`. (A spread profile
//      like AI_PROFILE.edit never carries either, so the spread doesn't satisfy
//      the pairing — the call must name both keys.) When the call names a
//      literal model above the cheapest, or a literal effort above `low`, an
//      adjacent justifying comment is required.
//   2. A hand-rolled backend runner argv that pushes a `--model` flag must also
//      push an effort flag (`--effort` for claude, `model_reasoning_effort=` for
//      codex). Backends with no effort flag (gemini / kimi / opencode — see
//      _shared/multi-agent-backends.md) are exempt.
//
// Why a check on top of the doc + the lib type: the lib makes both model and
// effort OPTIONAL (correct — gemini/kimi ignore effort), so the type system
// can't force the pairing or the floor at a callsite. This gate is the
// enforcement layer the optional fields can't provide.
//
// This check fails `check --all` when a scanned callsite (a) omits model or
// effort, (b) pins a literal (model, effort) pair off the canonical AI_TIER
// ladder row for that tier model, or (c) escalates a literal above the floor
// with no adjacent comment. Exit codes: 0 — every AI spawn pins both, matches
// the ladder, and justifies any escalation; 1 — at least one does not.
//
// Usage: node scripts/fleet/check/ai-spawns-have-paired-effort.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { globSync } from '@socketsecurity/lib-stable/globs/match'

import {
  FLOOR_EFFORT,
  FLOOR_MODEL,
  KNOWN_MODELS,
  isAdaptiveOnlyModel,
  ladderRowForModel,
} from '../lib/known-models.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Source roots that may hold an AI-spawn callsite. Skill/script/hook/workflow
// code only; dist, node_modules, and fixtures are excluded by the glob ignore.
const SCAN_GLOBS = [
  'scripts/**/*.mts',
  '.claude/skills/**/*.mts',
  '.claude/hooks/**/*.mts',
  '.claude/workflows/**/*.js',
  '.claude/workflows/**/*.mts',
] as const

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/*.test.mts',
  '**/test/**',
  // These checks name the field strings they scan for — exclude to avoid
  // false positives from comment/regex text that contains the scan patterns.
  '**/check/ai-spawns-have-paired-effort.mts',
  '**/check/fable-spawns-have-opus-fallback.mts',
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

// The floor + the canonical known-model set are derived in ONE shared lib
// (scripts/fleet/lib/known-models.mts) from socket-lib's AI_TIER + the pricing
// registry, so a model-generation bump is a single edit there — not a literal
// re-copied into each model-validating gate. Re-exported here for the test and
// any importer of this check.
export { FLOOR_EFFORT, FLOOR_MODEL, KNOWN_MODELS }

// Match the value of a property KEY inside an object-literal span. Returns the
// raw value text up to the next top-level `,` or the closing `}`, trimmed; or
// undefined when the key is shorthand (`model,`) or absent. The key-boundary
// shape mirrors the probes below: a boundary BEFORE the name (whitespace,
// comma, brace, start) so `model` doesn't match `customModel`.
export function propValue(span: string, key: string): string | undefined {
  // (?:[\s,{]|^) boundary; KEY; \s*: only the explicit key:value form carries a
  // value to inspect — shorthand has none, so it isn't matched here.
  const re = new RegExp(`(?:[\\s,{]|^)${key}\\s*:\\s*`)
  const m = re.exec(span)
  if (!m) {
    return undefined
  }
  const start = m.index + m[0].length
  let depth = 0
  for (let i = start, { length } = span; i < length; i += 1) {
    const ch = span[i]
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        return span.slice(start, i).trim()
      }
      depth -= 1
    } else if (ch === ',' && depth === 0) {
      return span.slice(start, i).trim()
    }
  }
  return span.slice(start).trim()
}

// A quoted string literal value (`'claude-opus-4-8'` / `"high"`). Returns the
// inner text, or undefined when the value is not a plain string literal (an
// identifier, a member access, a template with interpolation, etc.) — those
// can't be floor-checked statically, so they're left to the pin-both rule.
export function stringLiteral(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  // ^['"`] … matching close at end, with no other quote of that kind inside.
  const m = /^(['"`])([^'"`]*)\1$/.exec(value)
  return m ? m[2] : undefined
}

// Is there a justifying comment adjacent to the call? "Adjacent" = a `//` or
// `/* */` comment inside the call's object-literal span, OR on one of the lines
// immediately preceding the call (we look back a few lines from the call start).
export function hasAdjacentComment(
  text: string,
  callStart: number,
  span: string,
): boolean {
  if (/\/\/|\/\*/.test(span)) {
    return true
  }
  // Look back at the lines just before the call for a comment line.
  const before = text.slice(0, callStart)
  const lines = before.split('\n')
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 4; i -= 1) {
    const line = lines[i]!.trim()
    if (line === '') {
      continue
    }
    seen += 1
    if (
      line.startsWith('//') ||
      line.startsWith('*') ||
      line.startsWith('/*')
    ) {
      return true
    }
  }
  return false
}

// A spawnAiAgent({...}) / Workflow agent({...}) call must pin BOTH model and
// effort, and any literal above the floor must carry an adjacent comment.
export function scanSpawnCalls(
  text: string,
): Array<{ index: number; detail: string }> {
  const hits: Array<{ index: number; detail: string }> = []
  // spawnAiAgent({…}) is the lib helper; agent({…}) is the Workflow driver's
  // per-agent spawn in two forms:
  //   - agent({…})           — object-first (single-arg)
  //   - agent(prompt, {…})   — two-arg form used in saved workflows
  // The relaxed regex matches an optional identifier first-arg before the {,
  // so the object literal that begins the options bag is always what braceAt
  // (and thus objectSpan) lands on.
  const callRe =
    /(?:spawnAiAgent|\bagent)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(text))) {
    const callStart = m.index
    const braceAt = text.indexOf('{', callStart)
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
    // A Workflow `agent(` body that isn't an AI-spawn options object (no model
    // AND no effort key, no prompt) is a false positive — skip it. spawnAiAgent
    // is always an AI spawn; agent() is only when it carries the spawn shape.
    const isSpawnHelper = /spawnAiAgent\s*\(\s*\{$/.test(
      text.slice(callStart, braceAt + 1),
    )
    const looksLikeSpawn =
      isSpawnHelper ||
      hasModel ||
      hasEffort ||
      // A `prompt` object-key: `prompt` preceded by whitespace / `,` / `{` / line
      // start, then `:` / `,` / `}` — i.e. an options-bag shaped like an AI spawn.
      /(?:[\s,{]|^)prompt\s*[:,}]/.test(span)
    if (!looksLikeSpawn) {
      continue
    }
    if (!hasModel || !hasEffort) {
      const missing =
        !hasModel && !hasEffort
          ? '`model` and `effort`'
          : !hasModel
            ? '`model`'
            : '`effort`'
      hits.push({
        index: callStart,
        detail: `${callKind(isSpawnHelper)} omits ${missing}. Pin BOTH — default to the floor (model '${FLOOR_MODEL}', effort '${FLOOR_EFFORT}'); a spread profile never carries either.`,
      })
      continue
    }
    // Both pinned — flag a literal escalation above the floor with no comment.
    const modelLit = stringLiteral(propValue(span, 'model'))
    const effortLit = stringLiteral(propValue(span, 'effort'))
    // A literal model must be a model the fleet actually knows. Catches the
    // drift class — a stale id (`claude-sonnet-4-5`) that reads plausible but
    // no longer exists — that the escalation-comment rule waves through.
    if (modelLit !== undefined && !KNOWN_MODELS.has(modelLit)) {
      hits.push({
        index: callStart,
        detail: `${callKind(isSpawnHelper)} pins an unknown model '${modelLit}' — not in the canonical registry (scripts/fleet/constants/model-pricing.json) or AI_TIER. A stale/renamed id or a typo; use a current model id.`,
      })
    }
    // LADDER-PAIR rule: a literal Claude TIER model must ride with its
    // canonical AI_TIER row effort — (haiku, low), (sonnet, medium),
    // (opus, high). An off-row pair (`claude-haiku-4-5` + `high`) mismatches
    // model and effort in one of the two directions the token-spend rule names,
    // and no justifying comment legalizes it: pick the tier whose ROW matches
    // the job instead. Adaptive-only models (fable / mythos) take no effort
    // knob at all — the fable-spawns gate owns that surface, so they're
    // skipped here. Non-tier models (codex / open-weight ids) have no ladder
    // row and are left to the pin-both + known-model rules.
    if (
      modelLit !== undefined &&
      effortLit !== undefined &&
      !isAdaptiveOnlyModel(modelLit)
    ) {
      const row = ladderRowForModel(modelLit)
      if (row && effortLit !== row.effort) {
        hits.push({
          index: callStart,
          detail: `${callKind(isSpawnHelper)} pins an off-ladder pair (model '${modelLit}', effort '${effortLit}'). The canonical AI_TIER row for the ${row.tier} tier is (model '${row.model}', effort '${row.effort}'). Use effort '${row.effort}', or move to the tier whose row matches the job.`,
        })
        continue
      }
    }
    const modelEscalates = modelLit !== undefined && modelLit !== FLOOR_MODEL
    const effortEscalates =
      effortLit !== undefined && effortLit !== FLOOR_EFFORT
    if (
      (modelEscalates || effortEscalates) &&
      !hasAdjacentComment(text, callStart, span)
    ) {
      const what = [
        modelEscalates ? `model '${modelLit}' (floor '${FLOOR_MODEL}')` : '',
        effortEscalates
          ? `effort '${effortLit}' (floor '${FLOOR_EFFORT}')`
          : '',
      ]
        .filter(Boolean)
        .join(' and ')
      hits.push({
        index: callStart,
        detail: `${callKind(isSpawnHelper)} escalates above the floor (${what}) with no adjacent justifying comment. Explain the spend in a comment on or above the call.`,
      })
    }
  }
  return hits
}

// Human-readable name for the call shape, for the violation message.
export function callKind(isSpawnHelper: boolean): string {
  return isSpawnHelper ? 'spawnAiAgent({…})' : 'agent({…})'
}

// A hand-rolled backend runner argv that pushes `--model` must also push an
// effort flag — but ONLY for the claude / codex backends. kimi / gemini /
// opencode have no reasoning-effort flag (see _shared/multi-agent-backends.md),
// so their `--model` push is legitimately effort-free and must NOT be flagged.
//
// Scoping: each backend's `run()` body is a small block keyed by the backend
// name (`claude: { … }`, `codex: { … }`, `kimi: { … }`). We bind a `--model`
// push to the NEAREST preceding backend key, then only require an effort flag
// when that owning block is claude or codex. Binding to the nearest key (rather
// than testing a proximity window for any claude/codex signal) is what keeps a
// kimi block from being implicated by a claude block sitting above it in the
// same registry — the kimi push's nearest key is `kimi:`, not `claude:`. A
// block also counts as claude/codex when it carries that backend's model env
// var (`CLAUDE_MODEL` / `CODEX_MODEL`) or a `bin: 'claude'|'codex'` literal.
export function scanBackendArgv(
  text: string,
): Array<{ index: number; detail: string }> {
  const hits: Array<{ index: number; detail: string }> = []
  // A backend block opens with its name as a property key: `claude: {`.
  const backendKeyRe = /(\w+)\s*:\s*\{/g
  // Env-var or bin literal marking a block as claude: `CLAUDE_MODEL` or `bin: 'claude'`.
  const CLAUDE_BLOCK_RE = /CLAUDE_MODEL|bin:\s*['"]claude['"]/
  // Env-var or bin literal marking a block as codex: `CODEX_MODEL` or `bin: 'codex'`.
  const CODEX_BLOCK_RE = /CODEX_MODEL|bin:\s*['"]codex['"]/
  const modelFlagRe = /['"]--model['"]/g
  let m: RegExpExecArray | null
  while ((m = modelFlagRe.exec(text))) {
    // Find the nearest backend key opening before this --model push; that key
    // names the block the push belongs to.
    let ownerKey = ''
    let ownerStart = 0
    backendKeyRe.lastIndex = 0
    let k: RegExpExecArray | null
    while ((k = backendKeyRe.exec(text)) && k.index < m.index) {
      ownerKey = k[1]!
      ownerStart = k.index
    }
    // The block runs from its key to this push; both the key name and any
    // env-var / bin literal inside it identify the backend.
    const block = text.slice(ownerStart, m.index + 1)
    const isClaudeBlock = ownerKey === 'claude' || CLAUDE_BLOCK_RE.test(block)
    const isCodexBlock = ownerKey === 'codex' || CODEX_BLOCK_RE.test(block)
    // kimi / gemini / opencode block → no effort flag expected → skip.
    if (!isClaudeBlock && !isCodexBlock) {
      continue
    }
    // The effort flag may trail the --model push, so look at the whole block
    // plus a short tail.
    const around = text.slice(ownerStart, m.index + 400)
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
