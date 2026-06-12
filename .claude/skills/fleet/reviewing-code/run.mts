/**
 * Reviewing-code skill runner — multi-agent multi-pass review of a branch.
 *
 * Pipeline (defaults): 1. spec-compliance — codex (gates the quality passes) 2.
 * discovery — codex 3. discovery-secondary — codex 4. remediation — codex 5.
 * verify — claude.
 *
 * Each pass picks the preferred backend per role from a small registry, with
 * graceful fallback through the ordered preference list when a CLI isn't
 * installed. opencode is orchestrator-tier and only runs when explicitly
 * selected.
 *
 * See SKILL.md for full usage.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { which } from '@socketsecurity/lib/bin/which'
import { safeDelete } from '@socketsecurity/lib/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { isSpawnError } from '@socketsecurity/lib/process/spawn/errors'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

const logger = getDefaultLogger()

type Role =
  | 'spec-compliance'
  | 'discovery'
  | 'discovery-secondary'
  | 'remediation'
  | 'verify'

type BackendName = 'codex' | 'claude' | 'opencode' | 'kimi'

type BackendDescriptor = {
  readonly bin: string
  readonly hybrid: boolean
  readonly name: BackendName
  // Build the CLI argv given a prompt-file path and the temp output
  // path the runner will read after the process exits. Backends that
  // emit to stdout instead of an output file return outMode: 'stdout'
  // so the runner captures stdout into the output path itself.
  readonly run: (
    promptFile: string,
    outFile: string,
  ) => { argv: readonly string[]; outMode: 'file' | 'stdout' }
}

const BACKENDS: Readonly<Record<BackendName, BackendDescriptor>> = {
  __proto__: null,
  codex: {
    bin: 'codex',
    hybrid: false,
    name: 'codex',
    run(promptFile, outFile) {
      const model = process.env['CODEX_MODEL'] ?? 'gpt-5.5'
      const reasoning = process.env['CODEX_REASONING'] ?? 'xhigh'
      return {
        argv: [
          'exec',
          '--model',
          model,
          '-c',
          `model_reasoning_effort=${reasoning}`,
          '--full-auto',
          '--ephemeral',
          '-o',
          outFile,
          '-',
        ],
        outMode: 'file',
      }
    },
  },
  claude: {
    bin: 'claude',
    hybrid: false,
    name: 'claude',
    run(_promptFile, _outFile) {
      const model = process.env['CLAUDE_MODEL'] ?? 'opus'
      // Pair the model with a reasoning effort (claude `--effort`) — see
      // _shared/multi-agent-backends.md. Review is judgment-heavy, so the
      // default is `high`; codex's sibling knob is CODEX_REASONING. Fable /
      // Mythos are adaptive-thinking-only, so omit --effort for them rather
      // than pass a level they ignore.
      const effort = process.env['CLAUDE_EFFORT'] ?? 'high'
      const adaptiveOnly = /fable|mythos/i.test(model)
      const effortArgs = adaptiveOnly ? [] : ['--effort', effort]
      // Programmatic-Claude lockdown — all four flags per CLAUDE.md
      // (tools / allowedTools / disallowedTools / permission-mode).
      // The official permission flow is hooks → deny → mode → allow →
      // canUseTool; in dontAsk mode the last step is skipped, so any
      // tool not listed in `tools` is invisible to the model and any
      // tool in `disallowedTools` is denied even on bypass. Verify
      // pass is read-only by design: tools is the same set as
      // allowedTools (read + git introspection only), with Edit /
      // Write / destructive Bash explicitly denied.
      return {
        argv: [
          '--print',
          '--model',
          model,
          ...effortArgs,
          '--no-session-persistence',
          '--permission-mode',
          'dontAsk',
          '--tools',
          'Read',
          'Glob',
          'Grep',
          'Bash(git:*)',
          '--allowedTools',
          'Read',
          'Glob',
          'Grep',
          'Bash(git:*)',
          '--disallowedTools',
          'Edit',
          'Write',
          'Bash(rm:*)',
          'Bash(mv:*)',
        ],
        outMode: 'stdout',
      }
    },
  },
  opencode: {
    bin: 'opencode',
    hybrid: true,
    name: 'opencode',
    run(_promptFile, _outFile) {
      // opencode reads the prompt from stdin and writes to stdout in its
      // non-interactive `run` form. It is hybrid — it dispatches to whatever
      // provider its own config selects — so by default model selection lives
      // outside this runner (opencode's config / its `recent` model).
      //
      // `OPENCODE_MODEL` lets a caller pin a `provider/model` slug for this run
      // — the way the Fireworks + Synthetic providers are reached (e.g.
      // `fireworks-ai/accounts/fireworks/models/glm-5p1`,
      // `synthetic/hf:moonshotai/Kimi-K2.5`); see
      // _shared/multi-agent-backends.md for the provider-slug catalog. Absent
      // the env, opencode picks per its own config.
      const model = process.env['OPENCODE_MODEL']
      const argv = model ? ['run', '--model', model] : ['run']
      return {
        argv,
        outMode: 'stdout',
      }
    },
  },
  kimi: {
    bin: 'kimi',
    hybrid: false,
    name: 'kimi',
    run(_promptFile, _outFile) {
      const model = process.env['KIMI_MODEL'] ?? 'kimi-latest'
      // Tentative shape: kimi reads prompt from stdin, writes to stdout.
      // Adjust when the actual CLI surface is known.
      return {
        argv: ['chat', '--model', model, '--no-stream'],
        outMode: 'stdout',
      }
    },
  },
} as const

type RoleSpec = {
  readonly buildPrompt: (ctx: ReviewContext) => string
  readonly headingForVerify?: string | undefined
  readonly preferenceOrder: readonly BackendName[]
  // Wall-clock cap per spawn for this role. Heavyweight investigation
  // passes (discovery, discovery-secondary, remediation) cap at 15min
  // per docs/agents.md/fleet/agent-delegation.md — rescue-tier work.
  // Verify is a quick check on an already-written report, so 5min.
  // Spawn rejects on timeout; the catch in runBackend logs cleanly.
  readonly timeoutMs: number
}

const TIMEOUT_HEAVY_MS = 15 * 60 * 1000
const TIMEOUT_VERIFY_MS = 5 * 60 * 1000

const ROLES: Readonly<Record<Role, RoleSpec>> = {
  __proto__: null,
  'spec-compliance': {
    preferenceOrder: ['codex', 'kimi', 'claude'],
    timeoutMs: TIMEOUT_HEAVY_MS,
    buildPrompt:
      ctx => `Review the current branch for SPEC COMPLIANCE only. This pass gates the later quality review: the question is whether the change does what it set out to do, no more and no less — not whether the code is well written.

Scope:
- current branch: ${ctx.branch}
- base ref: ${ctx.baseRef}
- merge base: ${ctx.mergeBase}
- review range: ${ctx.range}

Commits in range:
${ctx.commitList}

Diff stat:
${ctx.diffStat}

Instructions:
- Inspect the repository directly. Use git diff, git log, git show, and read files as needed.
- Review only the changes introduced in ${ctx.range}. Do not review uncommitted changes.
- Infer the change's STATED INTENT from the commit messages, PR-style summary, and the shape of the diff. State that intent explicitly at the top so the reader can judge your verdict against it.
- Then assess three failure modes against that intent:
  - OVER-BUILDING: code added beyond what the intent requires — speculative abstraction, unused options, unrequested features, refactors riding along with a bug fix, error handling for cases that cannot happen.
  - SCOPE CREEP: changes to files / behavior unrelated to the stated intent.
  - UNDER-BUILDING: the intent is only partly delivered — a stated case left unhandled, a TODO standing in for the work, a path the change claims to cover but does not.
- Do NOT report code-quality, style, naming, or performance issues here. Those belong to the later quality pass. If you are unsure whether something is a compliance issue or a quality issue, leave it for quality.
- Every finding cites the affected file + line and explains how it diverges from the stated intent.
- End with an explicit verdict line: \`Spec compliance: PASS\` when the change matches its intent with no over/under/scope issues, or \`Spec compliance: CONCERNS\` with the count, so the orchestrator can gate.
- Return only the raw markdown document itself, suitable for saving under docs/. Do not add preamble, code fences, or wrapper text.

Use this structure:
# <descriptive title>
## Scope
## Stated Intent
## Spec Compliance
### Over-building
### Scope creep
### Under-building
<verdict line>
`,
  },
  discovery: {
    preferenceOrder: ['codex', 'kimi', 'claude'],
    timeoutMs: TIMEOUT_HEAVY_MS,
    buildPrompt:
      ctx => `Take a look at the current branch and give me a full and thorough review. This is a big one, so take your time.

A spec-compliance pass has already run and written its section to the report at \`${ctx.outputPath}\`. Preserve that section. Read it first, then add your findings BELOW it without removing or rewriting the spec-compliance content.

Scope:
- current branch: ${ctx.branch}
- base ref: ${ctx.baseRef}
- merge base: ${ctx.mergeBase}
- review range: ${ctx.range}

Commits in range:
${ctx.commitList}

Diff stat:
${ctx.diffStat}

Instructions:
- Inspect the repository directly. Use git diff, git log, git show, and read files as needed.
- Review only the changes introduced in ${ctx.range}.
- Do not review uncommitted changes.
- Your job is to find the most important bugs or behavioral regressions introduced by this branch.
- Focus first on finding the right issues. Do not spend much effort on fix design in this pass beyond short directional notes when necessary.
- Take your time and keep digging when you find a suspicious migration boundary, compatibility path, parser/serializer edge, or unchanged consumer that still expects the old shape.
- Prioritize high-confidence findings, but be thorough once you identify a real issue.
- Do not optimize for brevity. Include enough supporting detail that the PR author can understand the bug and why it happens without re-reading the entire diff.
- Follow changed code into unchanged consumers, parsers, validators, readers, writers, and compatibility paths when needed.
- Focus on real bugs, regressions, broken edge cases, data integrity issues, error handling gaps, and missing regression tests.
- Ignore style-only feedback.
- Think independently. Do not optimize for a checklist or taxonomy of issue types.
- Every finding must be backed by concrete evidence from the code. If you cannot trace the bug clearly, lower confidence or move it to "Assumptions / Gaps" instead of presenting it as a finding.
- For especially important findings, include a concrete trace through the affected code path. If a small local repro is feasible, use it.
- For each finding, include affected file and line references, the issue, and the impact.
- If there are no findings, say that explicitly and mention any residual risks or validation gaps.
- Return only the raw markdown document itself, suitable for saving under docs/. Output the FULL document: keep the existing \`## Stated Intent\` and \`## Spec Compliance\` sections from the spec-compliance pass verbatim, and add your bug findings below them.
- Do not add preamble text, code fences, or wrapper text like "Updated <path>".

Use this structure (the Stated Intent + Spec Compliance sections are already present from the prior pass — preserve them):
# <descriptive title>
## Scope
## Stated Intent
## Spec Compliance
## Executive Summary
## Findings
### 1. <title>
Severity: <High|Medium|Low>
Summary
Affected Code
Why This Is A Problem
Impact
## Assumptions / Gaps
## Validation Notes
`,
  },
  'discovery-secondary': {
    preferenceOrder: ['codex', 'kimi', 'claude'],
    timeoutMs: TIMEOUT_HEAVY_MS,
    buildPrompt:
      ctx => `Take another look at the current branch and search for additional high-confidence findings that are not already documented in \`${ctx.outputPath}\`.

Scope:
- current branch: ${ctx.branch}
- base ref: ${ctx.baseRef}
- merge base: ${ctx.mergeBase}
- review range: ${ctx.range}

Instructions:
- Read the existing review report at \`${ctx.outputPath}\` only to understand which findings are already covered.
- Then do an independent second review of the same branch range using git diff, git log, git show, and file reads as needed.
- Review only the changes introduced in ${ctx.range}.
- Do not review uncommitted changes.
- Do not repeat, reword, split, or restate findings that are already in the report.
- Only add a new finding if it is a genuinely separate issue backed by concrete evidence in the code.
- There is no requirement to find additional issues. If you do not find additional high-confidence findings, return the report unchanged.
- Preserve the existing report content. If you add new findings, integrate them into the existing document by extending the \`## Findings\` section and updating the executive summary only as needed.
- Return only the raw markdown document itself, suitable for saving under docs/.
- Do not add preamble text, code fences, or wrapper text like "Updated <path>".
`,
  },
  remediation: {
    preferenceOrder: ['codex', 'kimi', 'claude'],
    timeoutMs: TIMEOUT_HEAVY_MS,
    buildPrompt:
      ctx => `Read the existing review report at \`${ctx.outputPath}\` and augment it with concrete fix suggestions and regression tests for every finding.

Scope:
- current branch: ${ctx.branch}
- base ref: ${ctx.baseRef}
- merge base: ${ctx.mergeBase}
- review range: ${ctx.range}

Instructions:
- Read the report file at this exact path: \`${ctx.outputPath}\`.
- Inspect the repository directly as needed using git diff, git log, git show, and file reads.
- Review only the changes introduced in ${ctx.range}.
- Do not review uncommitted changes.
- Preserve the report's findings, severity, and supporting evidence unless you discover a clear factual correction while tracing a fix. If you do find a clear correction, update the report itself rather than appending contradictory notes.
- For every finding, add:
  - \`Suggested Fix\`
  - \`Suggested Regression Tests\`
- Make the fix suggestions actionable. When appropriate, split them into short-term compatibility fixes and longer-term cleanup or migration follow-up.
- Add \`## Suggested Next Steps\` if the report does not already have one.
- Keep the document thorough. Do not remove supporting detail from the existing findings.
- Return only the full updated raw markdown document itself, suitable for saving under docs/.
- Do not add preamble text, code fences, or wrapper text like "Updated <path>".
`,
  },
  verify: {
    preferenceOrder: ['claude', 'kimi', 'codex'],
    headingForVerify: 'Verification',
    timeoutMs: TIMEOUT_VERIFY_MS,
    buildPrompt:
      ctx => `Review the saved markdown findings report at \`${ctx.outputPath}\` for accuracy.

Scope:
- current branch: ${ctx.branch}
- base ref: ${ctx.baseRef}
- merge base: ${ctx.mergeBase}
- review range: ${ctx.range}

Instructions:
- Read the report file at this exact path: \`${ctx.outputPath}\`.
- Verify each finding against the repository using git diff, git log, git show, and file reads as needed.
- Review only the changes introduced in ${ctx.range}.
- Do not review uncommitted changes.
- Be conservative. If you cannot trace a finding concretely, mark it as FALSE POSITIVE rather than giving it a soft pass.
- Verify both the finding itself and the soundness of the suggested fix.
- Output only a markdown section that starts exactly with the heading \`## <Backend> Verification\` (replace <Backend> with the agent name you are running as).
- For each finding, provide a verdict of CONFIRMED, LIKELY, or FALSE POSITIVE with a brief rationale.
- Also say whether the suggested fix is sound, incomplete, or needs a different approach.
- Then list any important missed findings that should have been in the original report.
- End with an overall recommendation and any validation caveats.
- Do not restate the full original report.
`,
  },
} as const

type ReviewContext = {
  readonly baseRef: string
  readonly branch: string
  readonly commitList: string
  readonly diffStat: string
  readonly mergeBase: string
  readonly outputPath: string
  readonly range: string
}

type Args = {
  readonly baseRef: string | undefined
  readonly cleanupTemp: boolean
  readonly only: ReadonlySet<Role> | undefined
  readonly outputPath: string | undefined
  readonly passOverrides: ReadonlyMap<Role, BackendName>
  readonly skipVerify: boolean
}

// Order is the contract: spec-compliance runs FIRST and gates the quality
// passes (discovery / remediation). Matching an implementation against its
// stated intent (over-building, scope creep, under-building) is cheaper to fix
// before quality review than after, and a quality pass on out-of-scope code
// wastes the round-trip. The check `review-stages-are-ordered.mts` asserts this
// ordering so it can't silently regress.
const ALL_ROLES: readonly Role[] = [
  'spec-compliance',
  'discovery',
  'discovery-secondary',
  'remediation',
  'verify',
]

// Pull the `## Stated Intent` + `## Spec Compliance` block out of the report so
// a later overwriting pass can't silently drop the gate's output. Returns the
// block (both headings through to the next `## Executive Summary` or end), or ''
// when the report has no spec-compliance section yet.
export function extractSpecSection(report: string): string {
  const start = report.search(/^## Stated Intent\b/m)
  if (start < 0) {
    return ''
  }
  const after = report.slice(start)
  const end = after.search(/^## Executive Summary\b/m)
  return (end < 0 ? after : after.slice(0, end)).trimEnd()
}

// Guarantee the spec-compliance block survives a pass that rewrote the whole
// report. If `written` already contains a `## Stated Intent` section the agent
// preserved it — return as-is. Otherwise re-insert the captured block ahead of
// the first `## ` section (or prepend it) so the gate's verdict is never lost.
export function ensureSpecSection(
  written: string,
  specSection: string,
): string {
  if (!specSection || /^## Stated Intent\b/m.test(written)) {
    return written
  }
  const firstSection = written.search(/^## /m)
  if (firstSection < 0) {
    return `${written.trimEnd()}\n\n${specSection}\n`
  }
  return `${written.slice(0, firstSection)}${specSection}\n\n${written.slice(firstSection)}`
}

export async function appendSkipNote(
  reportPath: string,
  role: Role,
  reason: string,
): Promise<void> {
  const existing = existsSync(reportPath)
    ? await fs.readFile(reportPath, 'utf8')
    : ''
  const note = `> Skipped pass: **${role}** — ${reason}`
  await fs.writeFile(reportPath, `${existing.trimEnd()}\n\n${note}\n`)
}

export async function appendVerificationSection(
  reportPath: string,
  section: string,
  backend: BackendName,
): Promise<void> {
  // Some backends ignore the "include the agent name in the heading"
  // instruction; if the section starts with `## Verification` or
  // similar, prepend the backend name for attribution.
  const titled = section.replace(
    /^## (Claude |Codex |Kimi |Opencode )?Verification\b/i,
    `## ${capitalize(backend)} Verification`,
  )
  const existing = await fs.readFile(reportPath, 'utf8')
  await fs.writeFile(
    reportPath,
    `${existing.trimEnd()}\n\n---\n\n${titled.trimEnd()}\n`,
  )
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export async function detectAvailableBackends(): Promise<
  ReadonlySet<BackendName>
> {
  // Fan out the `which` lookups instead of awaiting one at a time.
  // Cheap parallelism — N filesystem stats run concurrently rather
  // than serially.
  const names = Object.keys(BACKENDS) as BackendName[]
  const results = await Promise.all(
    names.map(async name => ({
      name,
      available: await isCommandAvailable(BACKENDS[name].bin),
    })),
  )
  return new Set(results.filter(r => r.available).map(r => r.name))
}

export async function git(
  args: readonly string[],
  cwd?: string,
): Promise<string> {
  const result = await spawn('git', args as string[], {
    cwd,
    stdio: 'pipe',
    stdioString: true,
  })
  return String(result.stdout ?? '').trim()
}

export function isBackendName(s: string): s is BackendName {
  return s in BACKENDS
}

export async function isCommandAvailable(bin: string): Promise<boolean> {
  // Use `which` from @socketsecurity/lib/bin instead of spawning
  // `command -v` with shell: true. The shell:true variant invokes
  // cmd.exe on Windows and mangles `command -v`; `which` is
  // cross-platform and avoids the shell entirely.
  return (await which(bin)) !== null
}

export function isRole(s: string): s is Role {
  return s in ROLES
}

// Strip claude-style "Updated <path>\n\n```markdown\n…\n```" wrappers
// some agents add even when asked not to. Lifted-and-portable parser.
export function normalizeMarkdown(text: string): string {
  if (!text) {
    return ''
  }
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) {
    return text
  }
  const firstStartsWithUpdated = /^Updated\s+\[/.test(lines[0] ?? '')
  const thirdIsCodeFence =
    lines[2] === '```' || lines[2] === '```markdown' || lines[2] === '```md'
  let lastNonEmpty = lines.length - 1
  while (lastNonEmpty >= 0 && lines[lastNonEmpty]!.trim() === '') {
    lastNonEmpty--
  }
  const lastIsClosingFence = lines[lastNonEmpty] === '```'
  if (firstStartsWithUpdated && lastIsClosingFence && thirdIsCodeFence) {
    return lines.slice(3, lastNonEmpty).join('\n').trimEnd() + '\n'
  }
  return text
}

export function parseArgs(argv: readonly string[]): Args {
  let baseRef: string | undefined
  let cleanupTemp = false
  let outputPath: string | undefined
  let skipVerify = false
  const only = new Set<Role>()
  const passOverrides = new Map<Role, BackendName>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base') {
      baseRef = argv[++i]
      continue
    }
    if (arg === '--output') {
      outputPath = argv[++i]
      continue
    }
    if (arg === '--cleanup-temp') {
      cleanupTemp = true
      continue
    }
    if (arg === '--skip-verify') {
      skipVerify = true
      continue
    }
    if (arg === '--only') {
      for (const r of argv[++i].split(',')) {
        if (!isRole(r)) {
          throw new Error(`--only: unknown role "${r}"`)
        }
        only.add(r)
      }
      continue
    }
    if (arg === '--pass') {
      const spec = argv[++i]
      const eq = spec.indexOf('=')
      if (eq < 0) {
        throw new Error(`--pass expects role=backend, got "${spec}"`)
      }
      const role = spec.slice(0, eq)
      const backend = spec.slice(eq + 1)
      if (!isRole(role)) {
        throw new Error(`--pass: unknown role "${role}"`)
      }
      if (!isBackendName(backend)) {
        throw new Error(`--pass: unknown backend "${backend}"`)
      }
      passOverrides.set(role, backend)
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return {
    baseRef,
    cleanupTemp,
    only: only.size > 0 ? only : undefined,
    outputPath,
    passOverrides,
    skipVerify,
  }
}

export function pickBackend(
  role: Role,
  available: ReadonlySet<BackendName>,
  override: BackendName | undefined,
): BackendName | undefined {
  if (override) {
    if (!available.has(override)) {
      logger.warn(
        `${role}: requested backend "${override}" is not installed; falling back to preference order`,
      )
    } else {
      return override
    }
  }
  for (const candidate of ROLES[role].preferenceOrder) {
    // opencode is hybrid — only used when explicitly selected via --pass.
    if (BACKENDS[candidate].hybrid) {
      continue
    }
    if (available.has(candidate)) {
      return candidate
    }
  }
  return undefined
}

export function printHelp(): void {
  // oxlint-disable-next-line socket/no-logger-newline-literal -- CLI help text is intentionally a single multi-line block; splitting would garble the columnar formatting users expect.
  logger.info(`Usage: node .claude/skills/reviewing-code/run.mts [options]

Options:
  --base <ref>            Base ref to review against (default: origin/HEAD or origin/main)
  --output <path>         Output markdown path (default: docs/<branch-slug>-review-findings.md)
  --skip-verify           Skip the verify pass entirely
  --only <roles>          Comma-separated subset of roles to run (discovery,discovery-secondary,remediation,verify)
  --pass <role>=<backend> Override the backend for a specific role (codex, claude, opencode, kimi)
  --cleanup-temp          Remove the temp directory on exit (default: keep for inspection)
  -h, --help              Show this help`)
}

export async function resolveBaseRef(
  provided: string | undefined,
  cwd: string,
): Promise<string> {
  if (provided) {
    return provided
  }
  // Default-branch fallback per CLAUDE.md: symbolic-ref → origin/main → origin/master.
  try {
    const headRef = await git(
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      cwd,
    )
    if (headRef.length > 0) {
      return headRef
    }
  } catch {
    // fall through
  }
  for (const branch of ['main', 'master']) {
    try {
      await git(
        ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
        cwd,
      )
      return `origin/${branch}`
    } catch {
      // try next
    }
  }
  return 'origin/main'
}

export async function runBackend(
  backend: BackendName,
  promptText: string,
  tempDir: string,
  passLabel: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string; logPath: string }> {
  const desc = BACKENDS[backend]
  const promptFile = path.join(tempDir, `${passLabel}.prompt.txt`)
  const outFile = path.join(tempDir, `${passLabel}.out.md`)
  const logFile = path.join(tempDir, `${passLabel}.log`)
  await fs.writeFile(promptFile, promptText)
  const { argv, outMode } = desc.run(promptFile, outFile)
  const stderrParts: string[] = []
  let stdout = ''
  try {
    const child = spawn(desc.bin, argv as string[], {
      cwd,
      stdio: 'pipe',
      stdioString: true,
      timeout: timeoutMs,
    })
    child.stdin?.end(promptText)
    const result = await child
    stdout = String(result.stdout ?? '')
    stderrParts.push(String(result.stderr ?? ''))
  } catch (e) {
    if (isSpawnError(e)) {
      stdout = String(e.stdout ?? '')
      stderrParts.push(String(e.stderr ?? ''))
    } else {
      stderrParts.push(e instanceof Error ? e.message : String(e))
    }
    await fs.writeFile(
      logFile,
      `# backend: ${backend}\n# argv: ${argv.join(' ')}\n# timeoutMs: ${timeoutMs}\n# error\n\n${stderrParts.join('\n')}\n\n=== STDOUT ===\n${stdout}\n`,
    )
    return { ok: false, output: '', logPath: logFile }
  }
  await fs.writeFile(
    logFile,
    `# backend: ${backend}\n# argv: ${argv.join(' ')}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderrParts.join('\n')}\n`,
  )
  let output = ''
  if (outMode === 'file') {
    if (existsSync(outFile)) {
      output = await fs.readFile(outFile, 'utf8')
    }
  } else {
    output = stdout
  }
  output = normalizeMarkdown(output)
  return { ok: output.trim().length > 0, output, logPath: logFile }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // Quick: must be in a git repo.
  let repoRoot: string
  try {
    repoRoot = await git(['rev-parse', '--show-toplevel'])
  } catch {
    logger.error('Must be run inside a git repository.')
    process.exit(1)
  }

  const branchRaw = await git(['branch', '--show-current'], repoRoot)
  const branch =
    branchRaw.length > 0
      ? branchRaw
      : `detached-${await git(['rev-parse', '--short', 'HEAD'], repoRoot)}`
  const baseRef = await resolveBaseRef(args.baseRef, repoRoot)
  const mergeBase = await git(['merge-base', baseRef, 'HEAD'], repoRoot)
  const range = `${mergeBase}..HEAD`
  const commitList = await git(
    ['log', '--oneline', '--no-decorate', range],
    repoRoot,
  )
  const diffStat = await git(['diff', '--stat', range], repoRoot)

  const outputPath =
    args.outputPath ??
    path.join(repoRoot, 'docs', `${slugify(branch)}-review-findings.md`)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const tempDir = mkdtempSync(
    path.join(os.tmpdir(), `reviewing-code.${slugify(branch)}.`),
  )

  const ctx: ReviewContext = {
    baseRef,
    branch,
    commitList,
    diffStat,
    mergeBase,
    outputPath,
    range,
  }

  const available = await detectAvailableBackends()
  logger.info(`Available backends: ${[...available].join(', ') || '(none)'}`)
  logger.info(`Logs and prompts kept under: ${tempDir}`)

  const rolesToRun = ALL_ROLES.filter(r => {
    if (args.only && !args.only.has(r)) {
      return false
    }
    if (r === 'verify' && args.skipVerify) {
      return false
    }
    return true
  })

  // Captured after the spec-compliance pass so later overwriting passes can't
  // silently drop the gate's verdict (code-level guarantee, not prompt trust).
  let specSection = ''

  for (let i = 0, { length } = rolesToRun; i < length; i += 1) {
    const role = rolesToRun[i]!
    const passLabel = `${rolesToRun.indexOf(role) + 1}-${role}`
    const backend = pickBackend(role, available, args.passOverrides.get(role))
    if (!backend) {
      logger.warn(`${passLabel}: no backend available; skipping`)
      await appendSkipNote(outputPath, role, 'no available backend')
      continue
    }
    const roleSpec = ROLES[role]
    logger.info(
      `${passLabel}: running on ${backend} (timeout ${Math.round(roleSpec.timeoutMs / 60000)}m)`,
    )
    const promptText = roleSpec.buildPrompt(ctx)
    const result = await runBackend(
      backend,
      promptText,
      tempDir,
      passLabel,
      repoRoot,
      roleSpec.timeoutMs,
    )
    if (!result.ok) {
      logger.error(`${passLabel}: failed; see ${result.logPath}`)
      await appendSkipNote(
        outputPath,
        role,
        `${backend} failed (see ${result.logPath})`,
      )
      continue
    }
    if (role === 'verify') {
      await appendVerificationSection(outputPath, result.output, backend)
    } else if (role === 'spec-compliance') {
      // The gate creates the report. Capture its section so later passes that
      // rewrite the whole document can't drop it.
      await fs.writeFile(outputPath, result.output)
      specSection = extractSpecSection(result.output)
    } else if (role === 'discovery-secondary') {
      // Only overwrite if the secondary pass actually returned a
      // different document (caller asked for "no diff = no change").
      const before = existsSync(outputPath)
        ? await fs.readFile(outputPath, 'utf8')
        : ''
      const merged = ensureSpecSection(result.output, specSection)
      if (before.trim() !== merged.trim()) {
        await fs.writeFile(outputPath, merged)
      } else {
        logger.info(`${passLabel}: no additional findings; report unchanged`)
      }
    } else {
      // discovery / remediation rewrite the whole report; re-insert the
      // spec-compliance section if the agent dropped it.
      await fs.writeFile(
        outputPath,
        ensureSpecSection(result.output, specSection),
      )
    }
  }

  if (args.cleanupTemp) {
    await safeDelete(tempDir)
  }

  logger.info('')
  logger.info(`Code review for: ${branch}`)
  logger.info(`Report:    ${outputPath}`)
  logger.info(`Base ref:  ${baseRef}`)
  logger.info(`Merge base: ${mergeBase}`)
  logger.info(`Range:     ${range}`)
  if (!args.cleanupTemp) {
    logger.info(`Temp dir:  ${tempDir}`)
  }
}

main().catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
