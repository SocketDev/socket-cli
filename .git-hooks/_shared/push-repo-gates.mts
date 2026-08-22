// Pre-push repo-level gates that run against the working-tree state (not a
// commit range): submodule pristine-ness, soak-bypass date annotations, the
// fast lint/format gate, and the wheelhouse-only hook-dispatch-table drift check.

import { existsSync, readFileSync } from 'node:fs'

import path from 'node:path'

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { gitLines } from './git.mts'
import { scanSoakExcludeDateAnnotations } from './scan-supply-chain.mts'

const logger = getDefaultLogger()

// Submodule pristine check — refuses push if any submodule has a
// drifted commit pointer or unresolved merge conflict.
export const checkSubmodules = (): number => {
  if (!existsSync('.gitmodules')) {
    return 0
  }
  logger.info('Checking submodules are pristine…')
  let errors = 0
  const status = gitLines('submodule', 'status')
  for (const line of status) {
    if (!line) {
      continue
    }
    const prefix = line[0]
    const rest = line.slice(1).trim().split(/\s+/)
    const smPath = rest[1] || '<unknown>'
    if (prefix === '+') {
      logger.fail(`Submodule has wrong commit: ${smPath}`)
      logger.info(`  Run: git submodule update --init ${smPath}`)
      errors++
    } else if (prefix === 'U') {
      logger.fail(`Submodule has merge conflict: ${smPath}`)
      errors++
    }
    // '-' (uninitialized) is OK — CI shallow clones skip submodules.
  }
  if (errors > 0) {
    logger.error('')
    logger.fail(`Push blocked: ${errors} submodule(s) not pristine!`)
    logger.error('Fix submodules before pushing.')
    return errors
  }
  logger.success('All submodules pristine')
  return 0
}

// Soak-exclude date annotations (HARD block). pnpm-workspace.yaml exact-pin
// soak-bypass entries must carry the `# published: … | removable: …` line. The
// edit-time guard + the soak-excludes-have-dates check cover Claude edits + CI;
// this is the push-time tier for entries that arrived via non-Claude paths.
// File-targeted, not per-commit — the working-tree state is what ships.
export const scanSoakAnnotations = (): number => {
  const file = 'pnpm-workspace.yaml'
  if (!existsSync(file)) {
    return 0
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const hits = scanSoakExcludeDateAnnotations(text)
  if (hits.length === 0) {
    return 0
  }
  logger.fail(
    `${hits.length} soak-bypass entr${hits.length === 1 ? 'y' : 'ies'} in pnpm-workspace.yaml missing the date annotation:`,
  )
  const hs = hits.slice(0, 5)
  for (let i = 0, { length } = hs; i < length; i += 1) {
    const h = hs[i]!
    logger.info(`  ${h.lineNumber}: ${h.line.trim()}`)
  }
  logger.info(
    '  Add the line above each exact-pin: ' +
      '`# published: YYYY-MM-DD | removable: YYYY-MM-DD` ' +
      '(removable = published + 7d). The 7-day soak is malware protection.',
  )
  return hits.length
}

// Fast lint/format gate: catches lint/format drift before push, not just in
// CI ("green locally, red in CI" traces to nothing running lint at the push
// boundary). The FAST, build-INDEPENDENT slice: oxfmt --check + oxlint, never
// the full `check --all` (needs a built dist/, too slow for every push).
//
// MUST invoke the lint script DIRECTLY (`node <lint-script> …`), NOT via
// `pnpm run lint`: the `pnpm run` path triggers pnpm's deps-status check,
// which in a non-TTY context (CI, a linked worktree) tries to purge/reinstall
// node_modules and aborts (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`), a
// false push-block unrelated to lint.
//
// SCOPE: the pushed COMMITS via `--range=`, NEVER the working tree, which on a
// shared checkout also holds a parallel session's files. Empty `ranges` falls
// back to `--all`. See docs/agents.md/fleet/push-policy.md.
//
// Degrades to a skip (not a block) when there's no lint script, the script
// isn't a `node <path>` invocation, or there's no oxlint config. Bypass:
// `git push --no-verify`, `HUSKY=0`, or a redirected `core.hooksPath`, all
// phrase-gated for Claude by no-revert-guard. Returns 1 on lint failure, 0 on
// pass/skip.
export const scanFastChecks = (ranges: readonly string[] = []): number => {
  if (!existsSync('package.json')) {
    return 0
  }
  // Skip when the checkout lives under a path segment the formatter ignores
  // (e.g. a linked git worktree under `.claude/worktrees/...`): the lint
  // runner's `oxfmt .` resolves `.` to the abs worktree path, whose `.claude/`
  // ancestor matches the `**/.claude/**` ignore in .prettierignore, so EVERY
  // file is excluded → "Expected at least one target file" → a false block.
  // Such a worktree is a staging area for a push to main; CI re-lints from a
  // clean checkout, so skipping here loses nothing.
  let toplevel = ''
  try {
    toplevel = normalizePath(gitLines('rev-parse', '--show-toplevel')[0] ?? '')
  } catch {
    // bare repo / detached context — proceed, no skip.
  }
  // Matches `.claude` as a complete path segment anywhere in `toplevel`, start, middle, or end.
  if (/(?:^|\/)\.claude(?:\/|$)/.test(toplevel)) {
    logger.info(
      'Fast lint/format check skipped — checkout is under an ignored path (.claude/); CI re-lints from a clean tree.',
    )
    return 0
  }
  let pkg: { scripts?: Record<string, string> | undefined }
  try {
    pkg = JSON.parse(readFileSync('package.json', 'utf8')) as typeof pkg
  } catch {
    return 0
  }
  const lintScript = pkg.scripts?.['lint']
  // No `lint` script → this repo doesn't lint; nothing to gate.
  if (!lintScript) {
    return 0
  }
  // Extract the local node-script path from a `node <path> [args]` lint script
  // (the fleet shape is `node scripts/fleet/lint.mts`). A non-node lint script
  // can't be run directly here — skip rather than risk a pnpm reinstall.
  const m = /^node\s+(\S+\.[cm]?[jt]s)\b/.exec(lintScript.trim())
  if (!m || !existsSync(m[1]!)) {
    return 0
  }
  const scopeArgs =
    ranges.length > 0 ? ranges.map(range => `--range=${range}`) : ['--all']
  logger.info(
    ranges.length > 0
      ? `Running fast lint/format check on the pushed range (${ranges.join(', ')})…`
      : 'Running fast lint/format check on the whole tree (no pushed range to scope by)…',
  )
  // `CI=true`: lint.mts shells out to `pnpm exec oxfmt/oxlint`, and pnpm's
  // deps-status check aborts in a non-TTY context (a linked git worktree, a
  // headless run) trying to purge node_modules
  // (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Setting CI makes pnpm
  // non-interactive — it skips the purge prompt and proceeds — so the gate
  // runs the same everywhere (local TTY, worktree, CI) instead of false-
  // blocking a worktree push.
  const r = spawnSync(process.execPath, [m[1]!, ...scopeArgs], {
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    logger.fail(
      'Fast lint/format check failed — fix lint/format before pushing.',
    )
    logger.info(
      '  Run `pnpm run fix` to autofix, then re-push. Bypass once with ' +
        '`git push --no-verify` (records the skip).',
    )
    return 1
  }
  return 0
}

// The canonical fleet type gate — the same whole-project check the `type` npm
// script and CI run.
const TYPE_CHECK_TSCONFIG = path.join('.config', 'fleet', 'tsconfig.check.json')
const TSC_BIN = path.join('node_modules', 'typescript', 'bin', 'tsc')

// Regenerate the hook dispatch table so the whole-project type gate can resolve
// the generated `_shared` modules (`dispatch-table.mts` + variants), which are
// gitignored and absent in a fresh checkout. The write lands on gitignored
// paths, so it never dirties the tracked tree, and this runs AFTER
// scanDispatchDrift in the push sequence so a fresh regen here cannot mask a
// stale on-disk table. Best-effort: on a checkout without the generator (a
// non-wheelhouse member) it is a no-op, and if the regen fails tsc reds loudly
// on the missing module — the type gate is never silently a no-op.
const ensureDispatchTables = (): void => {
  const gen = path.join('scripts', 'fleet', 'gen', 'hook-dispatch.mts')
  if (!existsSync(gen)) {
    return
  }
  spawnSync(process.execPath, [gen], { stdio: 'ignore' })
}

// Fast TYPE gate — the type-check sibling of scanFastChecks. A type error is the
// OTHER class of breakage that reaches origin/main behind CI alone: oxlint and
// oxfmt run per-edit, but a type error only surfaces against the whole project,
// so a push carrying a bad type slipped straight to origin. Runs the canonical
// `tsc --noEmit -p .config/fleet/tsconfig.check.json` at the push boundary. A
// BACKSTOP: this hook is bypassed routinely, so CI's check job runs it too.
//
// Unlike scanFastChecks it does NOT skip under a `.claude/` worktree path. That
// skip exists only because the lint runner's `oxfmt .` resolves `.` to a path
// whose `.claude/` ancestor is ignored, excluding every file; tsc runs against
// an explicit project (`-p <tsconfig>`), so the `.`-resolution problem does not
// apply and a worktree push must NOT escape the type gate.
//
// Fails CLOSED: a checkout carrying the fleet tsconfig but no compiler cannot
// verify the push, so it is blocked, not skipped. A repo without the fleet
// tsconfig, a non-fleet member, has nothing to check here → skip. Returns 1 on a
// type error, or an unverifiable checkout, 0 on pass/skip.
// A tsc diagnostic line: `path/to/file.mts(12,7): error TS1234: message`.
const TS_ERROR_LINE_RE = /^(.+?)\((\d+),(\d+)\): error TS\d+:/mu

/**
 * The distinct files tsc reported errors in, repo-relative and `/`-normalized.
 * Pure — exported for tests.
 */
export function parseTypeErrorFiles(output: string): string[] {
  const seen = new Set<string>()
  const lines = output.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = TS_ERROR_LINE_RE.exec(lines[i]!)
    if (match?.[1]) {
      seen.add(normalizePath(match[1].trim()))
    }
  }
  return [...seen].toSorted()
}

/**
 * Split reported error files into the ones this push is answerable for and the
 * ones it is not.
 *
 * A DIRTY file's bytes are not in the push. An error located only in such a
 * file cannot exist at origin once the push lands, so blocking on it is wrong —
 * and in a shared checkout it is worse than wrong: a co-session's half-finished
 * edit blocks every unrelated push in the repo until they happen to finish.
 * Measured here, twice in one session: an untracked module's importer, then an
 * unused type in a file another session was mid-edit on.
 *
 * Everything else blocks. An error in a CLEAN file is committed state that CI
 * will see, and an error in a dirty file this push also touches is the author's
 * own. The conservative direction is deliberate: a diagnostic located in a
 * clean file but caused by a dirty one still blocks, because the location is
 * all tsc reports and a false block costs a re-push while a false pass reaches
 * origin.
 *
 * Pure over the three sets, so the rule is testable without a git tree.
 */
export function splitTypeErrorBlame(
  errorFiles: readonly string[],
  dirtyFiles: ReadonlySet<string>,
  pushedFiles: ReadonlySet<string>,
): { blocking: string[]; foreign: string[] } {
  // An EMPTY pushed set means the gate could not read what this push carries (a
  // new branch, a detached range, a git that would not answer) — not that the
  // push carries nothing. Attributing against it would call every dirty file
  // foreign and wave the whole push through, which is backwards: unknown has to
  // block, or the permissive path is exactly the one that fires when the gate
  // is least sure.
  if (pushedFiles.size === 0) {
    return { blocking: [...errorFiles], foreign: [] }
  }
  const blocking: string[] = []
  const foreign: string[] = []
  for (let i = 0, { length } = errorFiles; i < length; i += 1) {
    const file = errorFiles[i]!
    if (dirtyFiles.has(file) && !pushedFiles.has(file)) {
      foreign.push(file)
    } else {
      blocking.push(file)
    }
  }
  return { blocking, foreign }
}

/**
 * Working-tree paths with uncommitted changes, staged or not, including
 * untracked. `/`-normalized to match {@link parseTypeErrorFiles}.
 */
export function readDirtyFiles(): Set<string> {
  const out = new Set<string>()
  for (const line of gitLines('status', '--porcelain')) {
    // Porcelain is `XY <path>`, and a rename is `R  old -> new`.
    const body = line.slice(3).trim()
    if (!body) {
      continue
    }
    const arrow = body.lastIndexOf(' -> ')
    out.add(normalizePath(arrow === -1 ? body : body.slice(arrow + 4)))
  }
  return out
}

export const scanTypeCheck = (ranges: readonly string[] = []): number => {
  if (!existsSync('package.json') || !existsSync(TYPE_CHECK_TSCONFIG)) {
    return 0
  }
  if (!existsSync(TSC_BIN)) {
    logger.fail('Type check cannot run — the TypeScript compiler is missing.')
    logger.info(
      '  What: node_modules/typescript is absent but the fleet type gate ' +
        `(${TYPE_CHECK_TSCONFIG}) is present.\n` +
        '  Where: the checkout you are pushing from.\n' +
        '  Saw: no compiler; wanted: an installed toolchain to verify types.\n' +
        '  Fix: run `pnpm install`, then re-push.',
    )
    return 1
  }
  ensureDispatchTables()
  logger.info('Running type check…')
  // Captured rather than inherited so the diagnostics can be ATTRIBUTED. tsc
  // reads the working tree, which in a shared checkout holds a co-session's
  // half-finished edits — errors this push neither caused nor can fix.
  const r = spawnSync(
    process.execPath,
    [TSC_BIN, '--noEmit', '-p', TYPE_CHECK_TSCONFIG],
    { stdioString: true },
  )
  if (r.status === 0) {
    return 0
  }
  const output = `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`
  process.stderr.write(output.endsWith('\n') ? output : `${output}\n`)
  const errorFiles = parseTypeErrorFiles(output)
  // No parseable diagnostic means tsc failed some other way (a bad tsconfig, a
  // crash). Attribution cannot apply, so it blocks as before.
  const { blocking, foreign } =
    errorFiles.length === 0
      ? { blocking: errorFiles, foreign: [] }
      : splitTypeErrorBlame(
          errorFiles,
          readDirtyFiles(),
          new Set(pushedRangeFiles(ranges)),
        )
  if (blocking.length === 0 && foreign.length > 0) {
    logger.warn(
      `Type check reported ${foreign.length} file(s) with errors, all in uncommitted work this push does not carry — not blocking.`,
    )
    logger.info(
      `  Where: ${foreign.join(', ')}\n` +
        '  Why not blocking: those bytes are not in the push, so they cannot ' +
        'reach origin. In a shared checkout this is usually a parallel ' +
        'session mid-edit, and blocking would hold every unrelated push \n' +
        '  hostage until they finish.\n' +
        '  Note: CI still type-checks the merged result, and a push that ' +
        'lands them will be gated then.',
    )
    return 0
  }
  logger.fail('Type check failed — fix the type error(s) above before pushing.')
  logger.info(
    '  What: the tree does not type-check.\n' +
      '  Where: the file(line,col) reported above.\n' +
      '  Saw: a type error; wanted: `pnpm run type` clean (what CI verifies).\n' +
      '  Fix: resolve the error(s), commit, then re-push. Bypass once with ' +
      '`git push --no-verify` (records the skip).',
  )
  if (foreign.length > 0) {
    logger.info(
      `  Note: ${foreign.length} further file(s) with errors are uncommitted ` +
        'and not carried by this push, so they are not what is blocking you: ' +
        `${foreign.join(', ')}.`,
    )
  }
  return 1
}

/**
 * The files the pushed commits touch, `/`-normalized. Empty when there is no
 * range to read, which makes every error blocking — the conservative direction
 * when the gate cannot tell what is being pushed.
 */
export function pushedRangeFiles(ranges: readonly string[]): string[] {
  const out = new Set<string>()
  for (let i = 0, { length } = ranges; i < length; i += 1) {
    for (const line of gitLines('diff', '--name-only', ranges[i]!)) {
      const file = line.trim()
      if (file) {
        out.add(normalizePath(file))
      }
    }
  }
  return [...out]
}

// Dispatch-table drift — WHEELHOUSE-ONLY (gated on the canonical `template/base`
// seed, which only the wheelhouse has). The rolldown bundle's static dispatch
// table must match a fresh regen of the hooks present; a mismatch means a hook
// was added/removed without rebuilding, or a byte-cascaded table references an
// absent hook dir, the concurrent-cargo dangle. Caught at the push boundary so
// it can't reach origin/main and cascade fleet-wide. Members are NOT gated here:
// a member's byte-cascaded dispatch can legitimately differ from a fresh regen
// until the cascade regenerates per-tree, so blocking their push would
// false-fire — they rely on CI's `check --all` for the same check.
export const scanDispatchDrift = (): number => {
  if (!existsSync('template/base')) {
    return 0
  }
  const r = spawnSync(
    'node',
    ['scripts/fleet/check/dispatch-table-is-current.mts', '--quiet'],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) {
    logger.fail('Hook dispatch table is stale — rebuild before pushing.')
    logger.info(
      '  Run `node scripts/fleet/build-hook-bundle.mts`, commit the ' +
        'regenerated table + bundle, then re-push.',
    )
    return 1
  }
  return 0
}
