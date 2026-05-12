/**
 * reviewing-code skill runner — multi-agent four-pass review of a branch.
 *
 * Pipeline (defaults):
 *   1. discovery            — codex
 *   2. discovery-secondary  — codex
 *   3. remediation          — codex
 *   4. verify               — claude
 *
 * Each pass picks the preferred backend per role from a small registry,
 * with graceful fallback through the ordered preference list when a CLI
 * isn't installed. opencode is orchestrator-tier and only runs when
 * explicitly selected.
 *
 * See SKILL.md for full usage.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { which } from '@socketsecurity/lib/bin'
import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { isSpawnError, spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

type Role = 'discovery' | 'discovery-secondary' | 'remediation' | 'verify'

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
      const model = process.env['CODEX_MODEL'] ?? 'gpt-5.4'
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
      // opencode reads the prompt from stdin and writes to stdout in
      // its non-interactive form. It is hybrid (routes to other
      // providers internally per its config) so model selection lives
      // outside the runner.
      return {
        argv: ['run'],
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
  readonly headingForVerify?: string
  readonly preferenceOrder: readonly BackendName[]
}

const ROLES: Readonly<Record<Role, RoleSpec>> = {
  __proto__: null,
  discovery: {
    preferenceOrder: ['codex', 'kimi', 'claude'],
    buildPrompt: ctx => `Take a look at the current branch and give me a full and thorough review. This is a big one, so take your time.

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
- Return only the raw markdown document itself, suitable for saving under docs/.
- Do not add preamble text, code fences, or wrapper text like "Updated <path>".

Use this structure:
# <descriptive title>
## Scope
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
    buildPrompt: ctx => `Take another look at the current branch and search for additional high-confidence findings that are not already documented in \`${ctx.outputPath}\`.

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
    buildPrompt: ctx => `Read the existing review report at \`${ctx.outputPath}\` and augment it with concrete fix suggestions and regression tests for every finding.

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
    buildPrompt: ctx => `Review the saved markdown findings report at \`${ctx.outputPath}\` for accuracy.

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

const ALL_ROLES: readonly Role[] = [
  'discovery',
  'discovery-secondary',
  'remediation',
  'verify',
]

function parseArgs(argv: readonly string[]): Args {
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
    if (arg === '-h' || arg === '--help') {
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

function isRole(s: string): s is Role {
  return s in ROLES
}

function isBackendName(s: string): s is BackendName {
  return s in BACKENDS
}

function printHelp(): void {
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

async function git(args: readonly string[], cwd?: string): Promise<string> {
  const result = await spawn('git', args as string[], {
    cwd,
    stdio: 'pipe',
    stdioString: true,
  })
  return String(result.stdout ?? '').trim()
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function isCommandAvailable(bin: string): Promise<boolean> {
  // Use `which` from @socketsecurity/lib/bin instead of spawning
  // `command -v` with shell: true. The shell:true variant invokes
  // cmd.exe on Windows and mangles `command -v`; `which` is
  // cross-platform and avoids the shell entirely.
  return (await which(bin)) !== null
}

async function detectAvailableBackends(): Promise<ReadonlySet<BackendName>> {
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

function pickBackend(
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

async function runBackend(
  backend: BackendName,
  promptText: string,
  tempDir: string,
  passLabel: string,
  cwd: string,
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
      `# backend: ${backend}\n# argv: ${argv.join(' ')}\n# error\n\n${stderrParts.join('\n')}\n\n=== STDOUT ===\n${stdout}\n`,
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

// Strip claude-style "Updated <path>\n\n```markdown\n…\n```" wrappers
// some agents add even when asked not to. Lifted-and-portable parser.
function normalizeMarkdown(text: string): string {
  if (!text) {
    return ''
  }
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) {
    return text
  }
  const firstStartsWithUpdated = /^Updated\s+\[/.test(lines[0] ?? '')
  const thirdIsCodeFence =
    lines[2] === '```markdown' ||
    lines[2] === '```md' ||
    lines[2] === '```'
  let lastNonEmpty = lines.length - 1
  while (lastNonEmpty >= 0 && lines[lastNonEmpty]!.trim() === '') {
    lastNonEmpty--
  }
  const lastIsClosingFence = lines[lastNonEmpty] === '```'
  if (firstStartsWithUpdated && thirdIsCodeFence && lastIsClosingFence) {
    return lines.slice(3, lastNonEmpty).join('\n').trimEnd() + '\n'
  }
  return text
}

async function appendVerificationSection(
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function appendSkipNote(
  reportPath: string,
  role: Role,
  reason: string,
): Promise<void> {
  const existing = existsSync(reportPath) ? await fs.readFile(reportPath, 'utf8') : ''
  const note = `> Skipped pass: **${role}** — ${reason}`
  await fs.writeFile(
    reportPath,
    `${existing.trimEnd()}\n\n${note}\n`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // Sanity: must be in a git repo.
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
      : `detached-${(await git(['rev-parse', '--short', 'HEAD'], repoRoot))}`
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
  logger.info(
    `Available backends: ${[...available].join(', ') || '(none)'}`,
  )
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

  for (const role of rolesToRun) {
    const passLabel = `${rolesToRun.indexOf(role) + 1}-${role}`
    const backend = pickBackend(role, available, args.passOverrides.get(role))
    if (!backend) {
      logger.warn(`${passLabel}: no backend available; skipping`)
      await appendSkipNote(outputPath, role, 'no available backend')
      continue
    }
    logger.info(`${passLabel}: running on ${backend}`)
    const promptText = ROLES[role].buildPrompt(ctx)
    const result = await runBackend(
      backend,
      promptText,
      tempDir,
      passLabel,
      repoRoot,
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
    } else if (role === 'discovery-secondary') {
      // Only overwrite if the secondary pass actually returned a
      // different document (caller asked for "no diff = no change").
      const before = existsSync(outputPath) ? await fs.readFile(outputPath, 'utf8') : ''
      if (before.trim() !== result.output.trim()) {
        await fs.writeFile(outputPath, result.output)
      } else {
        logger.info(
          `${passLabel}: no additional findings; report unchanged`,
        )
      }
    } else {
      await fs.writeFile(outputPath, result.output)
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

async function resolveBaseRef(
  provided: string | undefined,
  cwd: string,
): Promise<string> {
  if (provided) {
    return provided
  }
  // Default-branch fallback per CLAUDE.md: symbolic-ref → origin/main → origin/master.
  try {
    const headRef = await git(
      [
        'symbolic-ref',
        '--quiet',
        '--short',
        'refs/remotes/origin/HEAD',
      ],
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

main().catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
