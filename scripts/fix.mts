/**
 * @fileoverview Auto-fix script — runs linters with --fix, then security
 * tools (zizmor, agentshield) if available, then an AI-assisted pass
 * for the lint findings the deterministic fixer can't safely handle.
 *
 * Steps:
 *   1. pnpm run lint --fix — oxlint + oxfmt (forwards extra argv like --all)
 *   2. zizmor --fix .github/ — GitHub Actions workflow fixes
 *      (skipped if .github/ doesn't exist)
 *   3. agentshield scan --fix — Claude config fixes
 *      (skipped if .claude/ or agentshield isn't installed)
 *   4. AI-assisted lint fix — headless claude (Sonnet) with a
 *      restricted toolset for judgment-call rules. Skipped silently
 *      when the claude CLI isn't installed, when SKIP_AI_FIX=1, or
 *      when --no-ai is passed. See scripts/ai-lint-fix.mts.
 *
 * Forwards `process.argv.slice(2)` to the lint step, so
 * `pnpm run fix --all` runs `pnpm run lint --fix --all` (full-tree
 * fix), and `pnpm run fix --staged` does the staged-only flow.
 */

import { existsSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const WIN32 = process.platform === 'win32'
const logger = getDefaultLogger()

async function run(
  cmd: string,
  args: string[],
  { label, required = true }: { label?: string; required?: boolean } = {},
): Promise<number> {
  try {
    const result = await spawn(cmd, args, {
      shell: WIN32,
      stdio: 'inherit',
    })
    if (result.code !== 0 && required) {
      logger.error(`${label || cmd} failed (exit ${result.code})`)
      return result.code
    }
    if (result.code !== 0) {
      // Non-blocking: log warning and continue.
      logger.warn(`${label || cmd}: exited ${result.code} (non-blocking)`)
    }
    return 0
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!required) {
      logger.warn(`${label || cmd}: ${msg} (non-blocking)`)
      return 0
    }
    throw e
  }
}

async function main(): Promise<void> {
  // Step 1: Lint fix — delegates to scripts/lint.mts which runs both
  // oxfmt and oxlint. Forward extra argv so `--all` / `--staged` /
  // explicit file paths reach the lint runner unchanged.
  const lintExit = await run(
    'pnpm',
    ['run', 'lint', '--fix', ...process.argv.slice(2)],
    { label: 'lint --fix' },
  )
  if (lintExit) {
    process.exitCode = lintExit
  }

  // Step 2: zizmor — fixes GitHub Actions workflow security issues.
  // Only runs if .github/ directory exists (some repos don't have workflows).
  if (existsSync('.github')) {
    await run('zizmor', ['--fix', '.github/'], {
      label: 'zizmor --fix',
      required: false,
    })
  }

  // Step 3: AgentShield — fixes Claude config security findings.
  // Only runs if .claude/ exists and agentshield binary is installed.
  if (existsSync('.claude') && existsSync('node_modules/.bin/agentshield')) {
    await run('pnpm', ['exec', 'agentshield', 'scan', '--fix'], {
      label: 'agentshield --fix',
      required: false,
    })
  }

  // Step 4: AI-assisted lint fix. Most lint rules ship a
  // deterministic autofix and Step 1 handled them. What remains is
  // the judgment-call set — rule violations whose right rewrite
  // depends on surrounding context that a regex / AST rewrite can't
  // safely infer. This step shells out to a headless Claude (Sonnet,
  // four-flag lockdown per CLAUDE.md "Programmatic Claude calls",
  // restricted toolset) to handle just those rules.
  //
  // Skipped silently when the claude CLI isn't on PATH, when
  // SKIP_AI_FIX=1, or when --no-ai is passed. CI sets SKIP_AI_FIX=1
  // because the fleet rule is "no AI in CI for code changes."
  await run('node', ['scripts/ai-lint-fix.mts', ...process.argv.slice(2)], {
    label: 'ai-lint-fix',
    required: false,
  })
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(msg)
  process.exitCode = 1
})
