/*
 * @file Auto-fix script — runs linters with --fix, then security tools (zizmor,
 *   agentshield) if available, then the fleet doctor for member-health fixes,
 *   then an AI-assisted pass for the lint findings the deterministic fixer
 *   can't safely handle. Steps:
 *
 *   1. pnpm run lint --fix — oxlint + oxfmt (forwards extra argv like --all)
 *   2. zizmor --fix .github/ — GitHub Actions workflow fixes (skipped if .github/
 *      doesn't exist)
 *   3. agentshield scan --fix — Claude config fixes (skipped if .claude/ or
 *      agentshield isn't installed)
 *   4. Fleet doctor --fix — auto-fixes catalog: refs missing their catalog entry
 *      from the cascaded fleet catalog (pnpm-workspace.fleet.yaml); reports
 *      soak-window install failures loud with the exact annotated exclude.
 *      Runs only when --all is passed (member-health fix, not staged-only).
 *   5. AI-assisted lint fix — headless claude (Sonnet) with a restricted toolset
 *      for judgment-call rules. Skipped silently when the claude CLI isn't
 *      installed, when SKIP_AI_FIX=1, or when --no-ai is passed. See
 *      scripts/fleet/ai-lint-fix.mts. Forwards `process.argv.slice(2)` to the
 *      lint step, so `pnpm run fix --all` runs `pnpm run lint --fix --all`
 *      (full-tree fix), and `pnpm run fix --staged` does the staged-only flow.
 *
 *   Scope: like lint.mts, the no-flag default is the MODIFIED (working-tree
 *   vs HEAD) scope. A run whose scope resolves to ZERO files early-exits
 *   before spawning any fixer — the release-pipeline preflight re-runs fix on
 *   a tree that is usually already clean at the receipt sha, and the full
 *   spawn chain (lint --fix, zizmor, agentshield, ai-lint-fix, verify lint)
 *   costs seconds-to-minutes for nothing. `--all` (and explicit file args)
 *   always run the full pipeline. The per-runner fixpoint caps
 *   (FORMAT_MAX_PASSES / OXLINT_MAX_PASSES in _shared/lint-runners.mts) are
 *   untouched — this exit sits entirely above them.
 *
 *   Concurrency: mutating runs hold the repo-scoped fixer lock
 *   (_shared/fixer-lock.mts) so concurrent/zombie fixers never race the same
 *   tree. On contention the run names the holder and exits non-zero fast.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { FLEET_CATALOG_YAML, PNPM_WORKSPACE_YAML, REPO_ROOT } from './paths.mts'
import { applyClaudeMdTrim } from './lib/claude-md-trim.mts'
import { applyStableAliasReconcile } from './lib/stable-alias.mts'
import { isCascadeMirrorPath } from './_shared/cascade-mirror-scope.mts'
import { getModifiedFiles, getStagedFiles } from './_shared/format-scope.mts'
import {
  acquireFixerLock,
  describeHolder,
  fixerLockPath,
} from './_shared/fixer-lock.mts'
import { resolveScopeMode } from './_shared/scope-flags.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const WIN32 = process.platform === 'win32'
const logger = getDefaultLogger()

// Pull the numeric exit code out of a lib-spawn rejection. The rejection
// carries `{ code }` — a number for a normal non-zero exit, a string (e.g.
// 'ENOENT') for a spawn failure. Non-numeric → 1 (treat as a generic failure).
function exitCodeOf(e: unknown): number {
  if (e && typeof e === 'object' && 'code' in e) {
    const { code } = e as { code: unknown }
    if (typeof code === 'number') {
      return code
    }
  }
  return 1
}

async function run(
  cmd: string,
  args: string[],
  {
    label,
    required = true,
  }: { label?: string | undefined; required?: boolean | undefined } = {},
): Promise<number> {
  try {
    const result = await spawn(cmd, args, {
      shell: WIN32,
      stdio: 'inherit',
    })
    return result.code ?? 0
  } catch (e) {
    // The lib `spawn` REJECTS on a non-zero exit (carrying `{ code }`), so a
    // "failing" command lands here, not the resolved branch. Surface the real
    // exit code instead of throwing — the caller decides what non-zero means.
    // Throwing here would abort the pipeline and skip later steps (notably
    // ai-lint-fix after `lint --fix` exits non-zero with AI-fixable errors).
    const code = exitCodeOf(e)
    if (required) {
      logger.error(`${label || cmd} failed (exit ${code})`)
    } else {
      logger.warn(`${label || cmd}: exited ${code} (non-blocking)`)
    }
    return code
  }
}

/**
 * True when a fix run should early-exit without spawning anything: no `--all`,
 * no explicit positional file args, and the git-derived scope resolved to zero
 * files — a clean scope has nothing for any fixer to touch. Pure — exported
 * for tests.
 */
export function shouldSkipCleanScope(
  argv: readonly string[],
  scopedFiles: readonly string[],
): boolean {
  if (argv.includes('--all')) {
    return false
  }
  // Explicit positional file paths (lint.mts's resolveExplicitFiles
  // convention) always run — they name exactly what to fix.
  if (argv.some(a => !a.startsWith('-'))) {
    return false
  }
  return scopedFiles.length === 0
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  // Clean-scope early exit: scoped (non---all) runs with nothing in scope
  // skip the whole fixer chain. The release-pipeline preflight and repeated
  // interactive `pnpm run fix` calls hit this path constantly.
  const mode = resolveScopeMode(argv)
  if (mode !== 'all') {
    // Live cascade-mirror payloads never count toward a dirty scope: they are
    // gated at the template source and the mutating runners skip them anyway
    // — a mirror-only scope, e.g. mid-cascade-landing, is a clean scope.
    const scoped = (
      mode === 'staged' ? getStagedFiles() : getModifiedFiles()
    ).filter(f => !isCascadeMirrorPath(f))
    if (shouldSkipCleanScope(argv, scoped)) {
      logger.log(
        `fix: no ${mode} files — clean scope, nothing to fix (pass --all for the repo-wide pass).`,
      )
      return
    }
  }

  // Serialize mutating fixers: one fixer per repo tree at a time. A live
  // holder is named and this run exits non-zero FAST (never queue behind an
  // interactive fixer); a dead holder's lock is stolen automatically.
  const lock = acquireFixerLock(
    fixerLockPath(REPO_ROOT),
    'scripts/fleet/fix.mts',
  )
  if (!lock.acquired) {
    logger.fail(`fix: ${describeHolder(lock.holder)}`)
    process.exitCode = 1
    return
  }
  try {
    await runFixers(argv)
  } finally {
    lock.release()
  }
}

async function runFixers(argv: string[]): Promise<void> {
  // Lint fix (oxfmt + oxlint via scripts/fleet/lint.mts). Forward extra argv so
  // `--all` / `--staged` / explicit file paths reach the runner unchanged.
  // NON-required: oxlint can't autofix custom socket/* JS-plugin rules, so a
  // non-zero exit is the EXPECTED case — those violations are what ai-lint-fix
  // (below) handles, and gating the pipeline here would skip it when it's needed
  // most. The real pass/fail is the verify run at the end of this function.
  await run('pnpm', ['run', 'lint', '--fix', ...argv], {
    label: 'lint --fix',
    required: false,
  })

  // zizmor — fixes GitHub Actions workflow security issues. Only runs when
  // .github/ exists (some repos don't have workflows).
  if (existsSync('.github')) {
    await run('zizmor', ['--fix', '.github/'], {
      label: 'zizmor --fix',
      required: false,
    })
  }

  // AgentShield — fixes Claude config security findings. Only runs when
  // .claude/ exists and agentshield binary is installed.
  if (existsSync('.claude') && existsSync('node_modules/.bin/agentshield')) {
    await run('pnpm', ['exec', 'agentshield', 'scan', '--fix'], {
      label: 'agentshield --fix',
      required: false,
    })
  }

  // Fleet doctor — member-health fixes. Runs after the deterministic
  // lint/security fixers and before AI (code-first-then-ai ordering). Scans
  // workspace package.jsons for catalog: refs missing their catalog entry and
  // splices the version from the cascaded fleet catalog. Reports soak-window
  // install failures loud with the exact annotated fix. Runs only when --all
  // is passed so staged-only flows are unaffected.
  let doctorCode = 0
  if (argv.includes('--all')) {
    doctorCode = await run('node', ['scripts/fleet/doctor.mts', '--fix'], {
      label: 'doctor --fix',
      required: false,
    })
  }

  // `-stable` alias reconcile — deterministic, so it runs before AI. Syncs any
  // `<name>-stable` catalog alias to its floating base version across the live
  // workspace + fleet catalog source (+ their template/base sources in the
  // wheelhouse). Idempotent + writes only on a real desync, so it is safe in
  // every flow (staged or --all). Pairs with the stable-aliases-match-base check.
  const reconciled = applyStableAliasReconcile([
    PNPM_WORKSPACE_YAML,
    FLEET_CATALOG_YAML,
    path.join(REPO_ROOT, 'template', 'base', 'pnpm-workspace.yaml'),
    path.join(
      REPO_ROOT,
      'template',
      'base',
      '.config',
      'fleet',
      'pnpm-workspace.fleet.yaml',
    ),
  ])
  for (let i = 0, { length } = reconciled; i < length; i += 1) {
    const r = reconciled[i]!
    const rel = path.relative(REPO_ROOT, r.file)
    for (let j = 0, jl = r.changed.length; j < jl; j += 1) {
      const c = r.changed[j]!
      logger.info(
        `fix: synced ${rel} '${c.alias}' ${c.aliasVersion} → ${c.baseVersion}`,
      )
    }
  }

  // CLAUDE.md fleet-block trim — deterministic, before AI. The fleet block is
  // byte-capped; bullets are a terse index whose detail lives in their linked
  // docs/agents.md page, so when the block is over cap the fix is to trim a
  // bullet's description, never to defer the rule. Only fires over cap, only on
  // the fattest doc-linked bullet, and reports each trim. Pairs with the
  // claude-md-section-size-guard cap gate.
  const trimmed = applyClaudeMdTrim([
    path.join(REPO_ROOT, 'CLAUDE.md'),
    path.join(REPO_ROOT, 'template', 'base', 'CLAUDE.md'),
  ])
  for (let i = 0, { length } = trimmed; i < length; i += 1) {
    const t = trimmed[i]!
    const rel = path.relative(REPO_ROOT, t.file)
    for (let j = 0, jl = t.trims.length; j < jl; j += 1) {
      logger.info(
        `fix: trimmed ${rel} L${t.trims[j]!.line + 1} (fleet block over cap)`,
      )
    }
  }

  // AI-assisted lint fix. Most lint rules ship a deterministic autofix and
  // the lint --fix step above handled them. What remains is the judgment-call
  // set — rule violations whose right rewrite depends on surrounding context
  // that a regex / AST rewrite can't safely infer. This step shells out to a
  // headless Claude (Sonnet, four-flag lockdown per CLAUDE.md "Programmatic
  // Claude calls", restricted toolset) to handle just those rules.
  //
  // Skipped silently when the claude CLI isn't on PATH, when
  // SKIP_AI_FIX=1, or when --no-ai is passed. CI sets SKIP_AI_FIX=1
  // because the fleet rule is "no AI in CI for code changes."
  await run('node', ['scripts/fleet/ai-lint-fix.mts', ...argv], {
    label: 'ai-lint-fix',
    required: false,
  })

  // Verify: re-run lint (no --fix) to set the real exit code. `fix` succeeds
  // only when nothing remains after the deterministic + AI passes; a lingering
  // violation (or a genuine lint crash) surfaces here as a non-zero exit.
  const verifyCode = await run('pnpm', ['run', 'lint', ...argv], {
    label: 'lint (verify)',
    required: false,
  })
  process.exitCode = verifyCode !== 0 ? verifyCode : doctorCode
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the script.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
