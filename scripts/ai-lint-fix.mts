/* oxlint-disable socket/inclusive-language -- AI-fix orchestrator documents the rules it handles, including the legacy terms each rule scans for. */

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
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { isSpawnError } from '@socketsecurity/lib/spawn/errors'
import { spawn } from '@socketsecurity/lib/spawn/core'

const logger = getDefaultLogger()

// Rules below need an AI-driven fix because the right rewrite
// depends on surrounding code structure that a regex / AST pass can't
// safely infer. Each one IS fixable — the AI step does the work.
// The deterministic linter already handled the unambiguous shapes;
// what remains is the structural-rewrite set.
const AI_HANDLED_RULES = new Set([
  // master/slave — context decides main/primary/controller vs
  // replica/worker. Other forms (whitelist/blacklist/etc.) auto-fix.
  'socket/inclusive-language',
  // Literal username in a user-home path. In source: substitute a
  // placeholder / env-var / delete. In WASM or generated bundles:
  // the bundler is leaking the path — fix the build config.
  'socket/personal-path-placeholders',
  // fs.access / fs.stat existence checks. AI rewrites the try/catch
  // → if/else and preserves metadata calls when the result is
  // destructured. Wrapper-name shapes (fileExists / pathExists /
  // isFile / isDir) auto-fix deterministically.
  'socket/prefer-exists-sync',
  // node:fs default/namespace where references are "weird" (computed
  // access, passed as a value, reassigned). Plain `fs.X` shapes
  // auto-fix via scope rename.
  'socket/prefer-node-builtin-imports',
  // spawnSync where the call site isn't already in async context or
  // its return value is consumed (assignment, property access).
  // await/expression-statement shapes auto-fix.
  'socket/prefer-async-spawn',
  // null whose surrounding type annotation also mentions null. AI
  // flips BOTH the annotation and the value in lockstep through the
  // function signatures / interfaces / return types involved.
  // Cross-file ripple is handled by per-file passes on the next run.
  'socket/prefer-undefined-over-null',
  // File splitting needs to choose natural seams.
  'socket/max-file-lines',
  // Placeholder finishes need actual implementation.
  'socket/no-placeholders',
  // No-fetch needs httpJson/httpText/httpRequest decision based on
  // how the response is consumed.
  'socket/no-fetch-prefer-http-request',
])

interface OxlintMessage {
  ruleId?: string
  message: string
  severity: number
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

interface OxlintFile {
  filePath: string
  messages: OxlintMessage[]
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
  for (const arg of argv) {
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
    const parsed = JSON.parse(stdout) as OxlintFile[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
  } catch {
    logger.warn('oxlint JSON parse failed; skipping AI-fix')
    return []
  }
}

function bucketFindings(files: OxlintFile[]): Map<string, OxlintMessage[]> {
  const byFile = new Map<string, OxlintMessage[]>()
  for (const f of files) {
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

/**
 * Per-rule guidance — concise, low-freedom (one canonical rewrite
 * per rule). Built per Anthropic's prompt-engineering best practices:
 * direct instructions, XML structure, examples per rule.
 *
 * Each entry is rendered into the prompt as `<rule id="...">…</rule>`
 * inside a `<rules>` block. Claude sees only the rules that fired in
 * the current file, so noise stays low.
 */
const RULE_GUIDANCE = {
  // oxlint-disable-next-line socket/prefer-undefined-over-null -- null-prototype object literal.
  __proto__: null,
  // oxlint-disable-next-line socket/inclusive-language -- rule guidance string documents the legacy terms it scans for.
  'socket/inclusive-language':
    'Replace `master`/`slave` with the contextually correct term: `main` (branch), `primary`/`controller` (process), `replica`/`worker`/`secondary`/`follower` (subordinate). Read the surrounding code to pick the right one. Do not autofix when an external API field name forces the legacy term — leave a `// inclusive-language: external-api` comment instead.',
  'socket/personal-path-placeholders':
    "Two scenarios. (1) Source code / docs / tests: replace literal usernames in user-home paths with the canonical placeholder — `<user>` for /Users/ and /home/, `<USERNAME>` for C:\\Users\\. Env-var forms (`$HOME`, `${USER}`, `%USERNAME%`) are also acceptable. (2) WASM / generated bundles / minified output: a literal username inside compiled output means the bundler is leaking the developer's path. Trace back to the build config (esbuild / rolldown / webpack `sourcemap`, `sourceRoot`, `__dirname` baking, fs.realpath calls in plugins) and fix THAT — do not chase the string in the artifact.",
  'socket/prefer-exists-sync':
    'Rewrite `fs.access` / `fs.stat` existence-checks to `existsSync(p)` from `node:fs`. Common shapes: `try { await fs.access(p); return true } catch { return false }` → `return existsSync(p)`. `await fs.access(p).then(() => true).catch(() => false)` → `existsSync(p)`. `if (await fs.stat(p))` → `if (existsSync(p))`. When the stat result is destructured for metadata (`s.size`, `s.mtime`, `s.isDirectory()`), KEEP the stat call and add a one-line comment stating intent — that is not an existence check. Trace back through callers: if the caller awaited a Promise<boolean>, the rewrite collapses to a sync boolean and the await becomes a no-op (safe).',
  'socket/prefer-node-builtin-imports':
    "Rewrite `import fs from 'node:fs'` / `import * as fs from 'node:fs'` to `import { … } from 'node:fs'` with the names actually used in the file. Change every `fs.X` reference to bare `X`. If `fs` is passed as a value (e.g. `someApi(fs)`), keep the namespace import and add a `// prefer-node-builtin-imports: passed-as-value` comment.",
  'socket/prefer-async-spawn':
    'Replace `spawnSync` from `node:child_process` with async `spawn` from `@socketsecurity/lib/spawn`. The lib spawn returns a thenable that yields `{ code, stdout, stderr }`; await it. If the caller is genuinely sync (no async ancestor, top-level CommonJS), leave the call and add a `// prefer-async-spawn: sync-required` comment.',
  'socket/prefer-undefined-over-null':
    'In the target file, flip BOTH the value and the surrounding type annotation in lockstep: `let x: string | null = null` → `let x: string | undefined = undefined`. Apply to function-parameter annotations, return-type annotations, generic-parameter constraints, interface / type-alias members. For tight-equality checks in the same file: `x === null` → `x === undefined` (loose `x == null` already covers both — leave loose-equality alone). DO NOT edit other files; if a caller in another file depends on the type, the lint rule will fire there on the next run and a separate AI-fix subprocess will pick it up. Skip the finding if the type is a third-party API contract you cannot change (e.g. a return type from a library).',
  'socket/max-file-lines':
    'Split the file along its natural seams: one tool/domain/phase per file. Name the new files descriptively (`spawn-cdxgen.mts`, `parse-arguments.mts`). Update import paths in callers. Do not introduce a barrel just to hide the split. If the file is a single legitimate parser/state-machine/table, add a leading `// max-file-lines: legitimate parser` comment instead of splitting.',
  'socket/no-placeholders':
    'Implement the placeholder. If the work is too large, do NOT delete the marker — leave the file unchanged and explain in your final reply.',
  'socket/no-fetch-prefer-http-request':
    'Replace `fetch(url, opts)` with the right helper from `@socketsecurity/lib/http-request`: `httpJson` when the caller calls `.json()` on the response, `httpText` when it calls `.text()`, `httpRequest` for raw access. Add the named import.',
} as unknown as Readonly<Record<string, string>>

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
  for (const f of findings) {
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
 *   - <task>: one-sentence framing.
 *   - <file>: the target path. Edits must stay scoped to it.
 *   - <findings>: machine-readable list of violations.
 *   - <rules>: per-rule canonical rewrite (low freedom).
 *   - <constraints>: hard rules — no Bash, no Write, single-file scope.
 *   - <output>: response format expectation.
 *
 * The prompt is deliberately short. Claude already knows what oxlint
 * is, what the rule names mean (the rules are project-specific, but
 * the guidance block carries enough context), and how to use Edit /
 * Read. Adding boilerplate dilutes the instructions.
 */
function buildPrompt(filePath: string, findings: OxlintMessage[]): string {
  const rel = path.relative(process.cwd(), filePath)
  const findingsBlock = renderFindings(findings, rel)
  const rulesBlock = renderRuleGuidance(findings)
  return `<task>Fix the lint findings in a single source file.</task>

<file>${rel}</file>

<findings>
${findingsBlock}
</findings>

${rulesBlock}

<constraints>
  <constraint>Read ${rel} with the Read tool before editing.</constraint>
  <constraint>Apply the minimum change needed to satisfy each finding. Preserve unrelated code, comments, and formatting.</constraint>
  <constraint>Edit only ${rel}. Do not create new files. Do not run Bash commands.</constraint>
  <constraint>If a finding requires changes you cannot safely make (e.g. file split, real implementation of a placeholder), skip it and state why in your reply. Do not delete the marker.</constraint>
  <constraint>If your fix could break callers in other files, skip the finding and state why.</constraint>
</constraints>

<output>One short sentence summarizing what you changed. No markdown, no code blocks, no preamble.</output>`
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
