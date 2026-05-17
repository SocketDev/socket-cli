/**
 * @fileoverview AI-assisted lint fix step.
 *
 * Runs after `pnpm run lint --fix` (oxlint + oxfmt deterministic
 * autofix) to handle the lint findings that aren't safely
 * mechanically fixable. The CLAUDE.md "Lint rules" guidance is to
 * autofix when the rewrite is unambiguous; what's left after the
 * deterministic pass is by definition the judgment-call set.
 *
 * Pipeline:
 *
 *   1. Run `pnpm run lint --json` to capture remaining violations.
 *   2. If there are any findings the AI step is allowed to handle,
 *      build a per-file batch and spawn a headless `claude --print`
 *      with Sonnet, the four lockdown flags, and a tight tool list
 *      (Read, Edit, Grep, Glob). Each spawn handles one file's
 *      worth of findings to keep the context window predictable.
 *   3. After all spawns finish, re-run `pnpm run lint` (without
 *      --fix) to verify nothing got worse. If the count went up,
 *      log a warning and exit non-zero.
 *
 * Skipped silently:
 *   - When the `claude` CLI isn't on PATH.
 *   - When `SKIP_AI_FIX=1` is set (CI sets this; AI-fix runs locally).
 *   - When `--no-ai` is passed.
 *
 * The four lockdown flags per CLAUDE.md "Programmatic Claude calls":
 *   - tools / allowedTools / disallowedTools / permissionMode.
 *
 * Cost / safety:
 *   - Sonnet 4.6, not Opus — judgment work but not architecturally
 *     deep; cost-tier-appropriate.
 *   - Per-file batches with a 5-minute timeout — bounds runaway loops.
 *   - Tools restricted to Read/Edit/Grep/Glob — no Bash, no Write of
 *     new files. The AI can only edit files that already exist.
 *   - permissionMode `acceptEdits` so Edit calls don't deadlock on
 *     the missing AskUserQuestion surface.
 *
 * Rule data (which rules the AI handles + per-rule guidance prompts)
 * lives in `./rule-guidance.mts` so the prompt corpus can be
 * reviewed / extended without touching the orchestrator logic.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { isSpawnError, spawn } from '@socketsecurity/lib-stable/spawn'

import { AI_HANDLED_RULES, RULE_GUIDANCE } from './rule-guidance.mts'

const logger = getDefaultLogger()

interface OxlintMessage {
  ruleId?: string | undefined
  message: string
  severity: number
  line: number
  column: number
  endLine?: number | undefined
  endColumn?: number | undefined
}

interface OxlintFile {
  filePath: string
  messages: OxlintMessage[]
}

/**
 * Raw shape of a diagnostic in oxlint's `--format=json` output.
 * The wrapper object is `{ "diagnostics": [Diagnostic, ...] }`.
 * Each diagnostic carries `code` (e.g. `"socket(rule-id)"`), `filename`,
 * and a `labels[]` array whose first entry has the source span.
 */
interface OxlintDiagnostic {
  code: string
  filename: string
  message: string
  severity: string
  labels: Array<{
    span: {
      offset: number
      length: number
      line: number
      column: number
    }
  }>
}

interface OxlintJsonOutput {
  diagnostics: OxlintDiagnostic[]
}

/**
 * Normalize oxlint's `{diagnostics:[...]}` payload into the ESLint-style
 * `OxlintFile[]` shape the rest of this CLI expects. Strip the
 * `socket(...)` wrapper around the rule code so AI_HANDLED_RULES (which
 * stores bare rule names) matches.
 */
function normalizeOxlintJson(payload: OxlintJsonOutput): OxlintFile[] {
  const byFile = new Map<string, OxlintMessage[]>()
  for (const d of payload.diagnostics) {
    const label = d.labels[0]
    if (!label) {
      continue
    }
    // `code` looks like "socket(prefer-async-spawn)" or
    // "eslint(no-unused-vars)"; strip the plugin wrapper.
    const ruleId =
      typeof d.code === 'string' && d.code.includes('(')
        ? d.code.replace(/^[^(]+\(([^)]+)\).*$/, '$1')
        : d.code
    const msg: OxlintMessage = {
      ruleId,
      message: d.message,
      severity: d.severity === 'error' ? 2 : 1,
      line: label.span.line,
      column: label.span.column,
    }
    const existing = byFile.get(d.filename)
    if (existing) {
      existing.push(msg)
    } else {
      byFile.set(d.filename, [msg])
    }
  }
  return Array.from(byFile, ([filePath, messages]) => ({ filePath, messages }))
}

interface CliArgs {
  noAi: boolean
  staged: boolean
  all: boolean
  passthrough: string[]
}

function parseArgs(argv: readonly string[]): CliArgs {
  const passthrough: string[] = []
  let noAi = false
  let staged = false
  let all = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--no-ai') {
      noAi = true
      continue
    }
    if (arg === '--staged') {
      staged = true
      passthrough.push(arg)
      continue
    }
    if (arg === '--all') {
      all = true
      passthrough.push(arg)
      continue
    }
    passthrough.push(arg)
  
  }
  return { all, noAi, passthrough, staged }
}

async function runLintJson(
  passthrough: readonly string[],
): Promise<OxlintFile[]> {
  // Run oxlint directly with --format=json. Bypass `pnpm run lint`
  // because that wrapper formats for humans.
  const args = [
    'exec',
    'oxlint',
    '--format=json',
    '--config=.config/oxlintrc.json',
    ...passthrough.filter(a => a !== '--all'),
  ]
  if (!passthrough.includes('--all') && !passthrough.includes('--staged')) {
    args.push('.')
  }
  let stdout = ''
  try {
    const result = await spawn('pnpm', args, {
      shell: process.platform === 'win32',
      stdio: 'pipe',
      stdioString: true,
    })
    stdout = String(result.stdout ?? '')
  } catch (e) {
    if (isSpawnError(e)) {
      // oxlint exits non-zero when there are violations — that's
      // expected. Read stdout regardless.
      stdout = String(e.stdout ?? '')
    } else {
      throw e
    }
  }
  if (!stdout.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(stdout) as OxlintJsonOutput
    if (!parsed || !Array.isArray(parsed.diagnostics)) {
      return []
    }
    return normalizeOxlintJson(parsed)
  } catch {
    logger.warn('oxlint JSON parse failed; skipping AI-fix')
    return []
  }
}

function bucketFindings(files: OxlintFile[]): Map<string, OxlintMessage[]> {
  const byFile = new Map<string, OxlintMessage[]>()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    const handled = f.messages.filter(
      m => m.ruleId && AI_HANDLED_RULES.has(m.ruleId),
    )
    if (handled.length === 0) {
      continue
    }
    byFile.set(f.filePath, handled)
  
  }
  return byFile
}

function renderFindings(findings: OxlintMessage[], _rel: string): string {
  return findings
    .map(
      f =>
        `<finding rule="${f.ruleId}" line="${f.line}" column="${f.column}">${f.message
          .replace(/[<>&]/g, ch =>
            ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;',
          )
          .replace(/\n/g, ' ')}</finding>`,
    )
    .map(line => `  ${line}`)
    .join('\n')
}

function renderRuleGuidance(findings: OxlintMessage[]): string {
  const seen = new Set<string>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    if (f.ruleId) {
      seen.add(f.ruleId)
    }
  
  }
  const entries = [...seen]
    .sort()
    .map(id => {
      const guidance = RULE_GUIDANCE[id]
      if (!guidance) {
        return ''
      }
      return `  <rule id="${id}">${guidance}</rule>`
    })
    .filter(s => s.length > 0)
  if (entries.length === 0) {
    return ''
  }
  return `<rules>\n${entries.join('\n')}\n</rules>`
}

/**
 * Build the per-file prompt. Structure follows Anthropic's prompt-
 * engineering best practices for headless tool-use:
 *
 *   - <role>: senior engineer doing a careful refactor — sets the
 *     bar above "quick autofix" so the model treats edge cases.
 *   - <task>: one-sentence framing.
 *   - <file>: the target path. Edits must stay scoped to it.
 *   - <findings>: machine-readable list of violations.
 *   - <rules>: per-rule canonical rewrite + good/bad examples (low
 *     freedom).
 *   - <process>: numbered steps that force a Read → reason → Edit →
 *     self-verify loop. Self-verify is the highest-leverage step —
 *     it catches the import/callsite mismatch class that produced
 *     past breakage.
 *   - <constraints>: hard rules — no Bash, no Write, single-file
 *     scope, no orphan imports.
 *   - <reminders>: instructions repeated at the END for the long-
 *     context regime per Anthropic guidance.
 *   - <output>: response format expectation, prefilled to suppress
 *     markdown / preamble.
 *
 * The prompt is intentionally short but the structure is explicit.
 * Adding boilerplate dilutes instructions; omitting the verify step
 * is how this prompt has historically produced orphan imports.
 */
function buildPrompt(filePath: string, findings: OxlintMessage[]): string {
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- relative path for prompt display; user invokes `pnpm run fix` from their cwd and expects paths relative to where they ran.
  const rel = path.relative(process.cwd(), filePath)
  const findingsBlock = renderFindings(findings, rel)
  const rulesBlock = renderRuleGuidance(findings)
  return `<role>
You are a principal TypeScript engineer with a perfectionist mindset applying a careful, minimal-diff refactor in response to lint findings. You hold yourself to a higher standard than the rule strictly requires: you read the whole file before touching it, you trace every reference you're about to rename, and you re-read the file after editing to confirm the result is internally consistent.

Opt for doing things correctly over cutting corners. If the right fix touches multiple parts of the file, do all of them. If the right fix requires understanding how a function is called within this file, read those callsites before editing. Never apply a partial fix that satisfies the lint message but leaves the file in a broken state. "Works on the happy path" is not done. "Builds, type-checks, and survives my own self-verification" is done.

A fix that introduces a runtime crash (e.g. renaming an imported binding without updating call sites) is worse than leaving the finding alone — when in doubt, skip the finding and report why.
</role>

<task>Fix the lint findings in a single source file. Do not edit other files.</task>

<file>${rel}</file>

<findings>
${findingsBlock}
</findings>

${rulesBlock}

<process>
  <step n="1">Use the Read tool to view ${rel} in full. Do not edit before reading.</step>
  <step n="2">For each finding, identify the canonical rewrite from the matching &lt;rule&gt; entry above. If multiple rewrites are possible, choose the one with the smallest diff.</step>
  <step n="3">Apply the rewrites with the Edit tool. Each Edit must preserve unrelated code, comments, blank lines, and formatting exactly.</step>
  <step n="4">SELF-VERIFY: use the Read tool to view ${rel} again. Walk through every import you changed and confirm every reference to the old name in the same file is either (a) covered by the new import, or (b) also rewritten in the same Edit pass. A file that imports X but uses Y, or imports Y but uses X, is broken — fix it before you stop.</step>
  <step n="5">Reply with ONE short sentence summarizing what changed and (if applicable) which findings you skipped and why.</step>
</process>

<constraints>
  <constraint>Edit only ${rel}. Do not create new files. Do not run Bash commands.</constraint>
  <constraint>NEVER end an edit with an imported binding that's not used, or a used identifier that's not imported. Self-verify (step 4) is required, not optional.</constraint>
  <constraint>If a finding requires changes you cannot safely make (e.g. splitting a 1000-line file, implementing a placeholder, a rewrite that ripples into other files), skip it and state why. Do not delete the marker, do not produce a partial fix, do not invent a workaround.</constraint>
  <constraint>If you cannot determine the right rewrite for a finding, skip it. A skipped finding will be re-evaluated on the next lint run; a wrong fix breaks the build.</constraint>
  <constraint>Apply the minimum diff needed. No drive-by cleanups, no reformatting, no "while I'm here" changes.</constraint>
</constraints>

<reminders>
The single most important step is step 4 (self-verify). Past failures: import binding renamed (\`spawnSync\` → \`spawn\`) but every call site still says \`spawnSync\` — module load crashes with ReferenceError. Local const injected when an \`export const\` of the same name already exists — module load crashes with redeclaration error. Both are caught by step 4. Run step 4 every time, no exceptions.
</reminders>

<output>One short sentence. No markdown, no code blocks, no preamble. Format: "Fixed N findings: <summary>." or "Fixed N findings, skipped M: <summary>; <skip reasons>." If you applied no edits, lead with "Skipped all findings: <reason>".</output>`
}

async function runClaudeFix(
  _filePath: string,
  prompt: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const claudeArgs = [
    '--print',
    '--model',
    'claude-sonnet-4-6',
    '--permission-mode',
    'acceptEdits',
    '--no-session-persistence',
    '--add-dir',
    cwd,
    '--allowedTools',
    'Read',
    'Edit',
    'Grep',
    'Glob',
    '--disallowedTools',
    'Bash',
    'Write',
    'WebFetch',
    'WebSearch',
    'Agent',
  ]
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  try {
    const child = spawn('claude', claudeArgs, {
      cwd,
      stdio: 'pipe',
      stdioString: true,
      timeout: 5 * 60 * 1000,
    })
    child.stdin?.end(prompt)
    const result = await child
    stdout = String(result.stdout ?? '')
    stderr = String(result.stderr ?? '')
    exitCode = result.code ?? 0
  } catch (e) {
    if (isSpawnError(e)) {
      stdout = String(e.stdout ?? '')
      stderr = String(e.stderr ?? '')
      exitCode = e.code ?? 1
    } else {
      stderr = e instanceof Error ? e.message : String(e)
      exitCode = 1
    }
  }
  return { exitCode, stderr, stdout }
}

async function hasClaudeCli(): Promise<boolean> {
  try {
    const result = await spawn('claude', ['--version'], {
      shell: process.platform === 'win32',
      stdio: 'pipe',
      stdioString: true,
      timeout: 5000,
    })
    return result.code === 0
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.noAi) {
    return
  }
  if (process.env['SKIP_AI_FIX'] === '1') {
    return
  }
  if (!existsSync('.config/oxlintrc.json')) {
    return
  }

  const files = await runLintJson(args.passthrough)
  const byFile = bucketFindings(files)
  if (byFile.size === 0) {
    return
  }

  if (!(await hasClaudeCli())) {
    const total = [...byFile.values()].reduce((n, m) => n + m.length, 0)
    logger.warn(
      `${total} AI-handled lint findings remain in ${byFile.size} files; skipping AI-fix step (claude CLI not on PATH).`,
    )
    return
  }

  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- relative path for log output; user invokes `pnpm run fix` from their cwd and expects paths relative to where they ran.
  const cwd = process.cwd()
  let totalEdits = 0
  let totalErrors = 0

  for (const [filePath, findings] of byFile) {
    const rel = path.relative(cwd, filePath)
    logger.log(`AI-fix ${rel} (${findings.length} findings)…`)
    const prompt = buildPrompt(filePath, findings)
    const { exitCode, stderr } = await runClaudeFix(filePath, prompt, cwd)
    if (exitCode === 0) {
      totalEdits += findings.length
      continue
    }
    totalErrors++
    logger.warn(`AI-fix exited ${exitCode} for ${rel}: ${stderr.slice(0, 200)}`)
  }

  // Verification — re-run lint and count remaining AI-handled
  // findings. Per CLAUDE.md / Anthropic best practices, "give Claude
  // a way to verify its work" is the highest-leverage thing; we do
  // it at the script level since the AI subprocesses don't have Bash.
  const beforeCount = [...byFile.values()].reduce((n, m) => n + m.length, 0)
  const afterFiles = await runLintJson(args.passthrough)
  const afterByFile = bucketFindings(afterFiles)
  const afterCount = [...afterByFile.values()].reduce((n, m) => n + m.length, 0)

  if (totalErrors > 0) {
    logger.warn(
      `AI-fix finished with ${totalErrors} subprocess errors. ${afterCount}/${beforeCount} findings remain. Re-run \`pnpm run lint\` to see what survived.`,
    )
    process.exitCode = 1
    return
  }
  if (afterCount > beforeCount) {
    logger.warn(
      `AI-fix introduced regressions: ${beforeCount} → ${afterCount} findings. Inspect the changes.`,
    )
    process.exitCode = 1
    return
  }
  logger.log(
    `AI-fix attempted ${totalEdits} findings across ${byFile.size} files (${beforeCount} → ${afterCount} remaining).`,
  )
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`ai-lint-fix: ${msg}`)
  process.exitCode = 1
})
