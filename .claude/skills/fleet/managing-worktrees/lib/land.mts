#!/usr/bin/env node
/*
 * @file Fast-land engine: move already-verified commits from a feature branch /
 *   worktree onto `origin/<default>` with the least ceremony that's still safe.
 *   The fleet lints AS IT EDITS (oxlint + oxfmt at edit time, the edit-time
 *   guards), so by the time a commit exists its diff has already passed the
 *   gates the pre-commit / pre-push hooks re-run. Re-running them on land is
 *   ceremony — and this session proved it can wedge (a pre-commit staged-test
 *   run hung 55 min) or crash (a fresh worktree has no node_modules, so the
 *   pre-push hooks throw ERR_MODULE_NOT_FOUND). This engine replaces the manual
 *   cherry-pick → fast-forward dance with one command:
 *
 *   1. Resolve the remote default branch (reuses resolveBase — never hard-coded).
 *   2. TYPE-CHECK the landing set with the canonical fleet type gate (tsc
 *      --noEmit -p .config/fleet/tsconfig.check.json). This is the ONE gate
 *      edit-time cannot re-assert incrementally: oxlint/oxfmt run per-edit, but
 *      a type error only surfaces against the whole project, so a fast-land that
 *      skipped tsc once shipped `safeReadFileSync(filePath, 'utf8')` (a wrong
 *      2nd arg) to origin and turned CI red. tsc is therefore MANDATORY — it
 *      runs even under --no-verify-lint / --no-verify-format, which skip only the
 *      heavy wedge, never this cheap high-value check. A type error aborts.
 *   3. CONFIRM each landing commit's changed files lint clean (a fast,
 *      deterministic re-assert of the edit-time gate — NOT a heavy test
 *      re-run). A dirty diff aborts: lint-as-edit is the contract, so a lint
 *      failure here means the contract was bypassed and the land is unsafe.
 *   5. Cherry-pick the commits onto a throwaway worktree branched off
 *      `origin/<base>` (a clean tree — no parallel-session dirt, no
 *      divergence).
 *   6. Fast-forward `origin/<base>` to the cherry-picked tip. NEVER force-push; if
 *      the push wouldn't be a clean fast-forward, abort and report (someone
 *      pushed since — re-run to pick up their commits).
 *   7. Remove the throwaway worktree + branch. Default is --dry-run, plan only.
 *      Pass --push to act. This is the engine behind `managing-worktrees land`.
 *      Usage: node land.mts <commit>... # dry-run: plan landing these commits
 *      node land.mts --last 2 # the last 2 commits of HEAD node land.mts
 *      <commit>... --push # actually land them node land.mts --last 2 --push
 *      --local # target the LOCAL <base> instead of origin — fast-forwards
 *      the primary checkout's branch, no push, the tool for landing
 *      verified worktree commits onto local main
 *      --no-verify-lint / --no-verify-format # skip the lint / format re-assert
 *      each only when a worktree can't run that tool. Neither skips the tsc
 *      type gate — that is mandatory and has no escape flag.
 */

import { existsSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { filterFormatIgnored } from '../../../../../scripts/fleet/_shared/format-scope.mts'
import { isMainModule } from '../../../../../scripts/fleet/_shared/is-main-module.mts'
import {
  git,
  gitOk,
  parseWorktreePorcelain,
  resolveBase,
} from '../../tidying-worktrees/lib/tidy-worktrees.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

// Replaying already-verified commits into the throwaway land worktree must not
// re-run git hooks. A cherry-pick fires the prepare-commit-msg / commit-msg
// hooks (it does NOT set the rebase-merge / rebase-apply state the fleet
// git-hook dispatcher self-skips on), and that worktree has no node_modules —
// so the lib-importing hooks throw ERR_MODULE_NOT_FOUND and abort the land.
// Pointing core.hooksPath at a path that holds no hooks disables them for the
// replay; the diff was gated at edit time and re-asserted on the commit bytes
// before the replay runs.
const HOOK_FREE_GIT: readonly string[] = ['-c', `core.hooksPath=${os.devNull}`]

// The extensions the fleet lint/format gates check — mirrors LINTABLE_EXTS in
// scripts/fleet/lint.mts so the land re-assert scopes to exactly the same file
// set the canonical gates do.
const REASSERT_EXTS: ReadonlySet<string> = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.mjs',
  '.mts',
  '.ts',
])

// The canonical fleet type gate — the same whole-project check the `type` npm
// script, the pre-push wedge, and CI run
// (`tsc --noEmit -p .config/fleet/tsconfig.check.json`). The land type re-assert
// runs this exact config so what lands matches what CI verifies.
const TYPE_CHECK_TSCONFIG: string = path.join(
  '.config',
  'fleet',
  'tsconfig.check.json',
)

export interface LandPlan {
  base: string
  commits: string[]
  worktreePath: string
  landBranch: string
}

/**
 * Resolve the list of commit SHAs to land. `--last N` expands to the last N
 * commits of HEAD, oldest-first, the cherry-pick order; explicit SHAs are
 * taken as-is, also normalized oldest-first by their commit order.
 */
export async function resolveCommits(
  repoDir: string,
  argv: string[],
): Promise<string[]> {
  const lastIdx = argv.indexOf('--last')
  if (lastIdx !== -1) {
    const n = Number(argv[lastIdx + 1])
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `--last needs a positive integer.\n  Saw: ${argv[lastIdx + 1]}\n  Fix: e.g. --last 2`,
      )
    }
    const range = await git(repoDir, [
      'rev-list',
      '--reverse',
      `HEAD~${n}..HEAD`,
    ])
    return range.split('\n').filter(Boolean)
  }
  // Explicit SHAs, everything that isn't a flag or a flag's value.
  const flagValues = new Set<string>()
  const commits: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--last') {
      flagValues.add(argv[i + 1] ?? '')
      continue
    }
    if (arg.startsWith('--') || flagValues.has(arg)) {
      continue
    }
    commits.push(arg)
  }
  return commits
}

/**
 * Files a commit changed, as repo-relative paths.
 */
export async function commitChangedFiles(
  repoDir: string,
  sha: string,
): Promise<string[]> {
  const out = await git(repoDir, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    sha,
  ])
  return out.split('\n').filter(Boolean)
}

/**
 * Re-assert the edit-time lint gate on the landing commits' changed files. The
 * fleet lints as it edits, so this should pass instantly; a failure means the
 * contract was bypassed and the land is unsafe. Returns true when clean (or
 * when there are no lintable files). Skipped by the caller under
 * --no-verify-lint (e.g. a worktree without node_modules).
 *
 * Delegates to `scripts/fleet/lint.mts <files>` — the wrapper that owns the
 * config plumbing (the `.mts` factory build, ignore-pattern re-rooting, the
 * generated socket plugin, mirror-file filtering). A hand-rolled bare-oxlint
 * invocation here drifted from that plumbing twice (a `.mts` config bare
 * oxlint silently no-ops on; unfiltered mirror payload), so the wrapper's exit
 * code is the one signal this gate trusts. Scopes the file set through the same
 * `filterFormatIgnored` (isNeverGated + merged .prettierignore) the canonical
 * gate uses, so a generated / vendored / dep-0 file the real gate skips never
 * false-reds the land.
 */
export async function lintLandsClean(
  repoDir: string,
  files: string[],
): Promise<boolean> {
  const lintable = filterFormatIgnored(
    files.filter(
      f =>
        REASSERT_EXTS.has(path.extname(f)) && existsSync(path.join(repoDir, f)),
    ),
    { cwd: repoDir },
  )
  if (!lintable.length) {
    return true
  }
  const lintWrapper = path.join(repoDir, 'scripts', 'fleet', 'lint.mts')
  if (
    !existsSync(lintWrapper) ||
    !existsSync(path.join(repoDir, 'node_modules', '.bin', 'oxlint'))
  ) {
    logger.warn(
      'land: the fleet lint wrapper (or oxlint) is not available in this checkout; ' +
        'cannot re-assert the lint gate. Pass --no-verify-lint to land anyway ' +
        '(only safe when the diff was lint-clean at edit time).',
    )
    return false
  }
  const result = (await spawn(
    process.execPath,
    [lintWrapper, ...lintable],
    // stdio MUST pipe — without it the lib spawn discards output and the
    // failure detail below is lost.
    { cwd: repoDir, stdio: 'pipe', stdioString: true },
  ).catch((e: unknown) => e)) as {
    code?: number | undefined
    exitCode?: number | undefined
    stdout?: string | undefined
    stderr?: string | undefined
  }
  const code = result?.code ?? result?.exitCode
  if (code === 0) {
    return true
  }
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.trim()
  if (output) {
    logger.error(output.split('\n').slice(-40).join('\n'))
  }
  return false
}

/**
 * Re-assert the edit-time FORMAT gate on the landing commits' changed files —
 * the oxfmt sibling of lintLandsClean. Delegates to `scripts/fleet/format.mts
 * --check <files>`, the canonical formatter that owns the config plumbing
 * (`buildOxfmtArgs` threads the fleet oxfmtrc + merged `--ignore-path`, so a
 * repo overlay's extra ignores are honored). The wrapper's exit code IS the
 * signal (0 = clean, non-zero = would reformat). Scopes the file set through
 * the same `filterFormatIgnored` (isNeverGated + merged .prettierignore) the
 * canonical gate uses, so a generated / vendored / dep-0 file the real gate
 * skips never false-reds the land. Returns true when clean (or when there are
 * no formattable files). Skipped by the caller under --no-verify-format (e.g. a
 * worktree without node_modules).
 */
export async function formatLandsClean(
  repoDir: string,
  files: string[],
): Promise<boolean> {
  const formattable = filterFormatIgnored(
    files.filter(
      f =>
        REASSERT_EXTS.has(path.extname(f)) && existsSync(path.join(repoDir, f)),
    ),
    { cwd: repoDir },
  )
  if (!formattable.length) {
    return true
  }
  const formatWrapper = path.join(repoDir, 'scripts', 'fleet', 'format.mts')
  if (
    !existsSync(formatWrapper) ||
    !existsSync(path.join(repoDir, 'node_modules', '.bin', 'oxfmt'))
  ) {
    logger.warn(
      'land: the fleet format wrapper (or oxfmt) is not available in this checkout; ' +
        'cannot re-assert the format gate. Pass --no-verify-format to land anyway ' +
        '(only safe when the diff was format-clean at edit time).',
    )
    return false
  }
  const result = (await spawn(
    process.execPath,
    [formatWrapper, '--check', ...formattable],
    // stdio MUST pipe — without it the lib spawn discards output and the
    // failure detail below is lost.
    { cwd: repoDir, stdio: 'pipe', stdioString: true },
  ).catch((e: unknown) => e)) as {
    code?: number | undefined
    exitCode?: number | undefined
    stdout?: string | undefined
    stderr?: string | undefined
  }
  const code = result?.code ?? result?.exitCode
  if (code === 0) {
    return true
  }
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.trim()
  if (output) {
    logger.error(output.split('\n').slice(-40).join('\n'))
  }
  return false
}

/**
 * Generate the hook dispatch table into `repoDir`. The whole-project type gate
 * resolves imports across the tree — including `_shared/dispatch-table.mts`,
 * which is generated, not committed, so a fresh land / gate worktree lacks it
 * and tsc would false-red on the missing module rather than surface real type
 * errors. Running the generator first makes the type check honest. A repo whose
 * checkout has no generator, a non-wheelhouse member, is a no-op. Best-effort:
 * a generator failure leaves the table absent, and tsc then reds loudly on the
 * missing module — the type gate is never silently turned into a no-op.
 */
export async function ensureDispatchTables(repoDir: string): Promise<void> {
  const gen = path.join(repoDir, 'scripts', 'fleet', 'gen', 'hook-dispatch.mts')
  if (!existsSync(gen)) {
    return
  }
  const result = (await spawn(process.execPath, [gen], {
    cwd: repoDir,
    stdio: 'pipe',
    stdioString: true,
  }).catch((e: unknown) => e)) as {
    code?: number | undefined
    exitCode?: number | undefined
  }
  const code = result?.code ?? result?.exitCode
  if (code !== 0) {
    logger.warn(
      'land: could not regenerate the hook dispatch table before the type ' +
        'check; tsc will report any resulting missing-module errors.',
    )
  }
}

/**
 * Run the fleet type gate against `tsconfigRelPath` under `repoDir` and return
 * true when it exits clean. Fails CLOSED when the compiler or config is absent:
 * a checkout that cannot run tsc cannot verify the landing set, so it must not
 * land. On a type error the compiler output is surfaced (What / Where — the
 * `file(line,col): error TSxxxx` lines — plus a Fix) so the operator sees the
 * exact breakage the fast-land refused to ship.
 */
export async function typeCheckPasses(
  repoDir: string,
  tsconfigRelPath: string,
): Promise<boolean> {
  const tsc = path.join(repoDir, 'node_modules', 'typescript', 'bin', 'tsc')
  const tsconfig = path.join(repoDir, tsconfigRelPath)
  if (!existsSync(tsc) || !existsSync(tsconfig)) {
    logger.error(
      'land: cannot run the type gate — the TypeScript compiler or ' +
        `${tsconfigRelPath} is missing from this checkout.\n` +
        '  Fix: run the land from a checkout with node_modules installed ' +
        '(the type check is mandatory and has no skip flag).',
    )
    return false
  }
  const result = (await spawn(
    process.execPath,
    [tsc, '--noEmit', '-p', tsconfig],
    // stdio MUST pipe — without it the lib spawn discards output and the
    // failure detail below is lost.
    { cwd: repoDir, stdio: 'pipe', stdioString: true },
  ).catch((e: unknown) => e)) as {
    code?: number | undefined
    exitCode?: number | undefined
    stdout?: string | undefined
    stderr?: string | undefined
  }
  const code = result?.code ?? result?.exitCode
  if (code === 0) {
    return true
  }
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`.trim()
  if (output) {
    logger.error(output.split('\n').slice(-40).join('\n'))
  }
  return false
}

/**
 * The land type gate: regenerate the dispatch table, then type-check the whole
 * project with the canonical fleet tsconfig. Mandatory — the caller runs this
 * even under --no-verify-lint / --no-verify-format, so a type error can never
 * reach main behind CI alone.
 */
export async function typeLandsClean(repoDir: string): Promise<boolean> {
  await ensureDispatchTables(repoDir)
  return await typeCheckPasses(repoDir, TYPE_CHECK_TSCONFIG)
}

export interface PickOutcome {
  readonly sha: string
  readonly outcome: 'applied' | 'skipped-already-landed' | 'conflict'
}

/**
 * Cherry-pick the series one commit at a time, recording a per-commit
 * outcome. A content-equivalent commit (already landed via a squash-merge
 * or auto-land — Mode 4's headline scenario) becomes empty and is DROPPED,
 * not misreported as a conflict; only a real conflict aborts. `--empty=drop`
 * needs git ≥ 2.45 — an older git's usage error falls back to a plain pick
 * plus an explicit empty-detect + `--skip`.
 */
export async function cherryPickSeries(
  worktreePath: string,
  commits: readonly string[],
): Promise<PickOutcome[]> {
  const outcomes: PickOutcome[] = []
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const sha = commits[i]!
    const before = await git(worktreePath, ['rev-parse', 'HEAD'])
    if (
      await gitOk(worktreePath, [
        ...HOOK_FREE_GIT,
        'cherry-pick',
        '--empty=drop',
        sha,
      ])
    ) {
      const after = await git(worktreePath, ['rev-parse', 'HEAD'])
      outcomes.push({
        sha,
        outcome: after === before ? 'skipped-already-landed' : 'applied',
      })
      continue
    }
    const opInProgress = await gitOk(worktreePath, [
      'rev-parse',
      '-q',
      '--verify',
      'CHERRY_PICK_HEAD',
    ])
    if (!opInProgress) {
      // No pick started — an old git rejected `--empty=drop` itself. Plain
      // pick, then classify a failure by hand.
      if (await gitOk(worktreePath, [...HOOK_FREE_GIT, 'cherry-pick', sha])) {
        outcomes.push({ sha, outcome: 'applied' })
        continue
      }
    }
    const conflicted =
      (
        await git(worktreePath, ['diff', '--name-only', '--diff-filter=U'])
      ).trim().length > 0
    if (
      !conflicted &&
      (await gitOk(worktreePath, [...HOOK_FREE_GIT, 'cherry-pick', '--skip']))
    ) {
      outcomes.push({ sha, outcome: 'skipped-already-landed' })
      continue
    }
    await git(worktreePath, [...HOOK_FREE_GIT, 'cherry-pick', '--abort'])
    outcomes.push({ sha, outcome: 'conflict' })
    return outcomes
  }
  return outcomes
}

/**
 * Borrow each workspace package's OWN `node_modules` into the gate worktree,
 * returning the links created.
 *
 * Pnpm's isolated layout puts a workspace package's declared dependencies in
 * `<pkg>/node_modules`, not the root one. A gate that borrows only the root
 * therefore cannot resolve them, and the mandatory tsc gate reports a phantom
 * error for code that is fine: `judgment-nudge` importing `compromise` failed
 * `TS2307: Cannot find module` inside the gate while the identical tree
 * type-checked clean (exit 0) in a normal checkout. A gate whose verdict is
 * wrong in the pessimistic direction is worse than no gate, because tsc here
 * has no skip flag.
 *
 * Packages come from git's tracked `package.json` set rather than from parsing
 * the pnpm-workspace globs: git already knows the tracked tree, so there is no
 * second glob dialect to drift. A package with no `node_modules` of its own is
 * skipped.
 */
async function linkPackageModules(
  repoDir: string,
  gateDir: string,
): Promise<string[]> {
  const tracked = await git(repoDir, ['ls-files', '-z', '*package.json'])
  const entries = tracked.split('\0')
  const created: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // git reports forward slashes, so the segment test needs no normalizing.
    if (!entry || entry.includes('node_modules/')) {
      continue
    }
    const dir = path.posix.dirname(entry)
    if (dir === '.') {
      continue
    }
    const from = path.join(repoDir, dir, 'node_modules')
    const to = path.join(gateDir, dir, 'node_modules')
    // lstat-free guards: the source must exist, the destination must not, and
    // the package dir must exist at THIS commit (a package added later is not
    // in the gate's tree).
    if (!existsSync(from) || existsSync(to) || !existsSync(path.dirname(to))) {
      continue
    }
    try {
      symlinkSync(from, to, 'dir')
      created.push(to)
    } catch {
      // Raced or unsupported — the gate degrades to the root link alone.
    }
  }
  return created
}

/**
 * Run `fn` against a throwaway GATE worktree checked out at `tipSha` —
 * the landing set's tip commit — with the primary checkout's
 * node_modules symlinked in for the toolchain. The edit-time gates then
 * assert the COMMIT bytes, not the working tree's: an uncommitted edit
 * or revert, sitting on a changed file in the invoking checkout can
 * neither green nor red a land it isn't part of.
 */
export async function withGateWorktree<T>(
  repoDir: string,
  tipSha: string,
  fn: (gateDir: string) => Promise<T>,
): Promise<T> {
  const gateDir = path.join(
    repoDir,
    '..',
    `${path.basename(repoDir)}-land-gate-${tipSha.slice(0, 8)}`,
  )
  if (existsSync(gateDir)) {
    await git(repoDir, ['worktree', 'remove', gateDir, '--force'])
  }
  await git(repoDir, ['worktree', 'add', '--detach', gateDir, tipSha])
  const linkedModules = path.join(gateDir, 'node_modules')
  let linkedPackages: string[] = []
  try {
    const primaryModules = path.join(repoDir, 'node_modules')
    if (existsSync(primaryModules) && !existsSync(linkedModules)) {
      symlinkSync(primaryModules, linkedModules, 'dir')
    }
    linkedPackages = await linkPackageModules(repoDir, gateDir)
    return await fn(gateDir)
  } finally {
    for (let i = 0, { length } = linkedPackages; i < length; i += 1) {
      const link = linkedPackages[i]!
      try {
        safeDeleteSync(link)
      } catch {
        // Already gone.
      }
    }
    try {
      safeDeleteSync(linkedModules)
    } catch {
      // Never linked, or already gone.
    }
    await git(repoDir, ['worktree', 'remove', gateDir, '--force']).catch(
      () => {},
    )
  }
}

/**
 * Build the land plan: resolve base + the throwaway worktree location.
 */
export async function planLand(
  repoDir: string,
  commits: string[],
): Promise<LandPlan> {
  if (!commits.length) {
    throw new Error(
      'land: no commits to land.\n  Fix: pass commit SHAs or --last <N>.',
    )
  }
  const base = await resolveBase(repoDir)
  // Stable, collision-resistant-enough name from the tip commit.
  const tip = commits[commits.length - 1]!.slice(0, 8)
  const landBranch = `land/fast-${tip}`
  const worktreePath = path.join(
    repoDir,
    '..',
    `${path.basename(repoDir)}-land-${tip}`,
  )
  return { base, commits, worktreePath, landBranch }
}

/**
 * Execute the plan: worktree off the base, per-commit cherry-pick with an
 * outcome table, verify fast-forward, finish, clean up. Two finishes:
 * origin mode (default) fast-forward-pushes `origin/<base>`; `--local`
 * mode fast-forwards the LOCAL `<base>` in the primary checkout — no push,
 * the tool for landing verified worktree commits onto local main.
 * Returns the landed tip SHA.
 */
export async function executeLand(
  repoDir: string,
  plan: LandPlan,
  options?: { local?: boolean | undefined } | undefined,
): Promise<string> {
  const opts = { __proto__: null, ...options } as {
    local?: boolean | undefined
  }
  const local = opts.local === true
  const { base, commits, landBranch, worktreePath } = plan
  const baseRef = local ? base : `origin/${base}`
  if (!local) {
    await git(repoDir, ['fetch', 'origin', base])
  }

  // Fresh worktree off the base — a clean tree, no divergence, no
  // parallel-session dirt.
  if (existsSync(worktreePath)) {
    await git(repoDir, ['worktree', 'remove', worktreePath, '--force'])
  }
  await git(repoDir, [
    'worktree',
    'add',
    '-b',
    landBranch,
    worktreePath,
    baseRef,
  ])

  try {
    const outcomes = await cherryPickSeries(worktreePath, commits)
    for (let i = 0, { length } = outcomes; i < length; i += 1) {
      const o = outcomes[i]!
      logger.log(`  ${o.sha.slice(0, 8)}  ${o.outcome}`)
    }
    const conflict = outcomes.find(o => o.outcome === 'conflict')
    if (conflict) {
      throw new Error(
        `land: ${conflict.sha.slice(0, 8)} hit a real conflict on the current ${baseRef} ` +
          `(${outcomes.filter(o => o.outcome === 'applied').length} applied, ` +
          `${outcomes.filter(o => o.outcome === 'skipped-already-landed').length} already landed before it).\n` +
          `  Fix: rebase that commit first, or land manually.`,
      )
    }
    if (!outcomes.some(o => o.outcome === 'applied')) {
      logger.success(
        `land: every commit is already content-equivalent on ${baseRef} — nothing to move.`,
      )
      return await git(worktreePath, ['rev-parse', 'HEAD'])
    }
    const tip = await git(worktreePath, ['rev-parse', 'HEAD'])

    // Confirm a clean fast-forward: the base must be an ancestor of tip.
    if (!local) {
      await git(repoDir, ['fetch', 'origin', base])
    }
    const isFf = await gitOk(worktreePath, [
      'merge-base',
      '--is-ancestor',
      baseRef,
      'HEAD',
    ])
    if (!isFf) {
      throw new Error(
        `land: ${baseRef} moved and is no longer an ancestor — not a clean fast-forward.\n` +
          `  Fix: re-run land (it re-cherry-picks onto the new ${baseRef}).`,
      )
    }

    if (local) {
      await finishLocalLand(repoDir, base, tip)
      return tip
    }
    // Fast-forward push. NEVER force. The pre-push hooks are skipped via
    // --no-verify because (a) the diff was lint-verified above and (b) a fresh
    // worktree may lack node_modules, which crashes the lib-importing hooks.
    await spawn('git', ['push', '--no-verify', 'origin', `HEAD:${base}`], {
      cwd: worktreePath,
      stdioString: true,
    })
    return tip
  } finally {
    await git(repoDir, ['worktree', 'remove', worktreePath, '--force']).catch(
      () => {},
    )
    await git(repoDir, ['branch', '-D', landBranch]).catch(() => {})
  }
}

/**
 * Fast-forward the LOCAL base branch to `tip`. The base is normally checked
 * out in the primary worktree, so the move runs THERE via `merge --ff-only`
 * (which updates its index + working tree consistently and refuses cleanly
 * on divergence or conflicting dirt). When no worktree has the base checked
 * out, a compare-and-swap `update-ref` moves it without touching any tree.
 */
export async function finishLocalLand(
  repoDir: string,
  base: string,
  tip: string,
): Promise<void> {
  const porcelain = await git(repoDir, ['worktree', 'list', '--porcelain'])
  const worktrees = parseWorktreePorcelain(porcelain)
  const holder = worktrees.find(w => w.branch === base)
  if (holder) {
    const merged = await gitOk(holder.path, ['merge', '--ff-only', tip])
    if (!merged) {
      throw new Error(
        `land: could not fast-forward local ${base} in ${holder.path} — it diverged or has conflicting dirt.\n` +
          `  Fix: re-run land (it re-cherry-picks onto the current ${base}), or resolve that checkout first.`,
      )
    }
    return
  }
  const oldTip = await git(repoDir, ['rev-parse', `refs/heads/${base}`])
  const swapped = await gitOk(repoDir, [
    'update-ref',
    `refs/heads/${base}`,
    tip,
    oldTip,
  ])
  if (!swapped) {
    throw new Error(
      `land: local ${base} moved while landing — not updating it out from under the writer.\n` +
        `  Fix: re-run land.`,
    )
  }
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const push = argv.includes('--push')
  const local = argv.includes('--local')
  const skipLint = argv.includes('--no-verify-lint')
  const skipFormat = argv.includes('--no-verify-format')
  const repoDir =
    (await git(process.cwd(), ['rev-parse', '--show-toplevel'])) ||
    process.cwd()

  const commits = await resolveCommits(repoDir, argv)
  const plan = await planLand(repoDir, commits)
  const target = local ? `local ${plan.base}` : `origin/${plan.base}`

  logger.log(`land: ${commits.length} commit(s) → ${target}`)
  for (const sha of commits) {
    const subject = await git(repoDir, ['log', '-1', '--format=%s', sha])
    logger.log(`  ${sha.slice(0, 8)} ${subject}`)
  }

  // Changed-file set shared by both edit-time re-assert gates (lint + format).
  // lintLandsClean / formatLandsClean scope this through the same
  // `filterFormatIgnored` (isNeverGated + merged .prettierignore) the canonical
  // gates use — cascade-mirror payload and generated/vendored artifacts are
  // gated at the template source only, and oxlint/oxfmt bypass their own
  // ignorePatterns for explicitly-passed files, so an unfiltered set would
  // false-red the land on dogfooded mirror bytes.
  const changed = new Set<string>()
  if (!skipLint || !skipFormat) {
    for (const sha of commits) {
      for (const f of await commitChangedFiles(repoDir, sha)) {
        changed.add(f)
      }
    }
  }

  {
    // Gate the COMMIT bytes: the tip of the landing set is checked out
    // into a throwaway gate worktree and the gates run there. The gate always
    // runs — the tsc type check below is mandatory regardless of the
    // --no-verify-lint / --no-verify-format skips.
    const tipSha = commits[commits.length - 1]!
    const gatesClean = await withGateWorktree(
      repoDir,
      tipSha,
      async gateDir => {
        // Type check FIRST: it is the mandatory minimal gate — the one check
        // edit-time cannot re-assert incrementally, so it is the last line
        // before a type error reaches main behind CI alone.
        const typeClean = await typeLandsClean(gateDir)
        if (!typeClean) {
          logger.error(
            'land: the landing commits do not type-check (the whole-project ' +
              'type gate that the pre-push wedge and CI run).\n' +
              '  Fix: resolve the type error(s) above + re-commit. The type ' +
              'check is mandatory — there is no skip flag.',
          )
          return false
        }
        logger.success(
          'land: landing commits type-check clean (mandatory type gate on ' +
            'commit bytes).',
        )
        if (!skipLint) {
          const clean = await lintLandsClean(gateDir, [...changed])
          if (!clean) {
            logger.error(
              'land: the landing commits do not lint clean (the lint-as-edit contract was bypassed).\n' +
                '  Fix: `pnpm run fix` the offending files + re-commit, or pass --no-verify-lint if you must.',
            )
            return false
          }
          logger.success(
            'land: landing commits lint clean (edit-time gate re-asserted on commit bytes).',
          )
        }
        if (!skipFormat) {
          const clean = await formatLandsClean(gateDir, [...changed])
          if (!clean) {
            logger.error(
              'land: the landing commits are not format-clean (the format-as-edit contract was bypassed).\n' +
                '  Fix: `pnpm run format` the offending files + re-commit, or pass --no-verify-format if you must.',
            )
            return false
          }
          logger.success(
            'land: landing commits are format-clean (edit-time gate re-asserted on commit bytes).',
          )
        }
        return true
      },
    )
    if (!gatesClean) {
      return 1
    }
  }

  if (!push) {
    logger.log(
      `land: dry-run. Would fast-forward ${target} to these commits via a throwaway worktree. Re-run with --push to act.`,
    )
    return 0
  }

  const tip = await executeLand(repoDir, plan, { local })
  logger.success(
    `land: fast-forwarded ${target} to ${tip.slice(0, 8)} (${commits.length} commit(s)).`,
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  void (async () => {
    process.exitCode = await main()
  })()
}
