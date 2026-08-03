/*
 * @file The fleet-fork decision engine — "is this Edit/Write/Bash-write a
 *   local fork of a fleet-canonical file?" Shared by the Claude
 *   `no-fleet-fork-guard` hook and the cross-CLI adapters
 *   (`scripts/fleet/cross-cli/fleet-fork-detect.mts` turns Codex/Kimi tool
 *   calls into paths and runs each through this same `check`), so every CLI
 *   enforces the identical rule from a single source of truth. Lives under
 *   `_shared/` (ships to members, survives the bundle-only cutover) because
 *   the cascaded cross-CLI adapters run in members.
 *   `fleetForkVerdict` detects a fleet-canonical edit by:
 *
 *   1. Resolving the absolute file path of the Edit/Write target (or, for a
 *      Bash write, the destination `extractBashWriteDestinations` pulled out
 *      of the shell command).
 *   2. Checking if the path is INSIDE socket-wheelhouse/template/ → allow (this IS
 *      the canonical home).
 *   3. Otherwise, resolving the repo's canonical set from its `.gitattributes`
 *      `linguist-generated=true` entries → block when the path is canonical
 *      the template is the single source of truth, with allowances for
 *      per-repo markers, operator-local overrides, fleet-block hybrid files,
 *      and the bypass phrase.
 *
 *   `check` (the Edit/Write/MultiEdit entry point) and `bashCheck` (the Bash
 *   entry point) both funnel into `fleetForkVerdict` so an `Edit` and a `cp`
 *   into the same fleet-canonical path get the identical verdict.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import {
  containsFleetBeginMarker,
  textHasFleetBlockMarkers,
} from './fleet-markers.mts'
import { bashGuard, block, editGuard } from './guard.mts'
import {
  commandWorkingDir,
  normalizeNewlineSeparators,
} from './shell-command.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from './transcript.mts'
import { isWheelhouseRoot } from './wheelhouse-root.mts'
import type { ParseEntry } from '@socketsecurity/lib-stable/shell/parse'
import type { GuardResult } from './guard.mts'
import type { ToolCallPayload } from './payload.mts'

const BYPASS_PHRASE = 'Allow fleet-fork bypass'

// File-path tokens that identify the socket-wheelhouse canonical
// home. If the resolved absolute path contains one of these, we're
// editing the source of truth — allow.
//
// `socket-wheelhouse/template/` covers the standard checkout shape
// (e.g. /Users/<user>/projects/socket-wheelhouse/template/...).
// `repo-template/template/` covers any rename / mirror / fork that
// keeps the trailing component.
const TEMPLATE_PATH_TOKENS = [
  '/socket-wheelhouse/template/',
  '/repo-template/template/',
]

/**
 * Find the fleet repo root for an absolute file path by walking up until we hit
 * a directory that has package.json AND a CLAUDE.md containing the
 * `<fleet-canonical>` marker. Returns the repo root path or undefined if the
 * file is outside a fleet repo.
 */
export function findFleetRepoRoot(filePath: string): string | undefined {
  let cur = path.dirname(filePath)
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    const pkgPath = path.join(cur, 'package.json')
    const claudePath = path.join(cur, 'CLAUDE.md')
    if (existsSync(pkgPath) && existsSync(claudePath)) {
      try {
        const claudeContent = readFileSync(claudePath, 'utf8')
        if (containsFleetBeginMarker(claudeContent)) {
          return cur
        }
      } catch {
        // unreadable — skip and continue walking up
      }
    }
    const parent = path.dirname(cur)
    /* c8 ignore start - parent===cur only fires on relative paths or exotic FSes; unreachable with absolute paths on Unix */
    if (parent === cur) {
      break
    }
    /* c8 ignore stop */
    cur = parent
  }
  return undefined
}

// True when the on-disk file carries the `<fleet-canonical>` block markers —
// i.e. it's a hybrid file whose content outside the markers is repo-owned. The
// markers are the same comment sentinels the sync's *-fleet-block checks use
// gitignore, gitattributes, workflows. Comment-prefix-agnostic: match the
// marker text regardless of the leading `#`.
function hasFleetBlockMarkers(absPath: string): boolean {
  if (!existsSync(absPath)) {
    return false
  }
  try {
    return textHasFleetBlockMarkers(readFileSync(absPath, 'utf8'))
  } catch {
    /* c8 ignore next - file exists but is unreadable; untestable without OS-level permission tricks */
    return false
  }
}

// Per-repo marker files: listed in the manifest's EXPECTED_FILES (presence
// required, CONTENT VARIES per repo), NOT IDENTICAL_FILES (byte-identical
// canonical). Every repo's socket-wheelhouse.json carries its own repoName /
// layout / native / kind — editing it downstream is normal per-repo work, not a
// canonical fork. Without this exemption the parent-dir-under-template rule in
// isCanonicalRelativePath marks `.config/socket-wheelhouse.json` canonical
// (because template/.config/ exists), false-blocking legitimate marker edits.
const PER_REPO_MARKER_PATHS: readonly string[] = [
  '.config/socket-wheelhouse.json',
  '.socket-wheelhouse.json',
]

export function isPerRepoMarkerPath(rel: string): boolean {
  return PER_REPO_MARKER_PATHS.includes(normalizePath(rel))
}

// Operator-local files live INSIDE a canonical dir (`.claude/`) but are
// gitignored and never cascaded — Claude Code reads `settings.local.json` as a
// per-machine override. Without this exemption the parent-dir-under-template
// rule in isCanonicalRelativePath marks it canonical (because `template/.claude/`
// exists), false-blocking a legitimate local settings edit.
const OPERATOR_LOCAL_PATHS: readonly string[] = ['.claude/settings.local.json']

export function isOperatorLocalPath(rel: string): boolean {
  return OPERATOR_LOCAL_PATHS.includes(normalizePath(rel))
}

// The fleet-canonical file set is the repo's `.gitattributes`
// `linguist-generated=true` entries — a cascade-GENERATED projection of the sync
// manifest (IDENTICAL_FILES + OPTIONAL_IDENTICAL_FILES + generated globs, built
// by gitattributes-fleet-block.mts). `.gitattributes` ships to EVERY fleet repo,
// so this resolves canonical status in members AND the wheelhouse alike. The
// retired predecessor probed `<repoRoot>/template/<dir>`, which matched nothing:
// members carry no `template/`, and the wheelhouse moved its canonical source to
// `template/base/` — so the guard was inert everywhere.
export function fleetCanonicalEntries(repoRoot: string): string[] {
  let content = ''
  try {
    content = readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8')
  } catch {
    return []
  }
  const entries: string[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = /^(\S+)\s.*\blinguist-generated=true\b/.exec(lines[i]!)
    if (match) {
      entries.push(normalizePath(match[1]!))
    }
  }
  return entries
}

export function isCanonicalRelativePath(
  rel: string,
  repoRoot?: string | undefined,
): boolean {
  if (!repoRoot) {
    return false
  }
  const normalized = normalizePath(rel)
  const entries = fleetCanonicalEntries(repoRoot)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // Skip glob entries, supplemental generated globs — this guard matches the
    // concrete canonical dirs + files; a glob is best-effort excluded so a bad
    // pattern can never over-block.
    if (entry.includes('*')) {
      continue
    }
    // Exact file match, or the edited path sits under a canonical dir entry.
    if (normalized === entry || normalized.startsWith(`${entry}/`)) {
      return true
    }
  }
  return false
}

export function isInsideTemplate(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return TEMPLATE_PATH_TOKENS.some(token => normalized.includes(token))
}

export function fleetForkVerdict(
  filePath: string,
  content: string | undefined,
  payload: ToolCallPayload,
): GuardResult {
  const absPath = path.resolve(filePath)

  // The canonical home is allowed.
  if (isInsideTemplate(absPath)) {
    return undefined
  }

  // Walk up to find the fleet repo root. If the file isn't inside a
  // fleet repo at all, this hook doesn't apply — let it through.
  const repoRoot = findFleetRepoRoot(absPath)
  if (!repoRoot) {
    return undefined
  }

  const relToRepo = path.relative(repoRoot, absPath)

  // Per-repo marker files carry per-repo content (EXPECTED_FILES, not
  // IDENTICAL_FILES) — editing them downstream is expected, not a fork.
  if (isPerRepoMarkerPath(relToRepo)) {
    return undefined
  }

  // Operator-local overrides, gitignored, never cascaded, are not forks.
  if (isOperatorLocalPath(relToRepo)) {
    return undefined
  }

  if (!isCanonicalRelativePath(relToRepo, repoRoot)) {
    return undefined
  }

  // Wheelhouse-own-README allowance: the wheelhouse's OWN root README.md is
  // authored repo content (`# socket-wheelhouse`, real badges, the Fleet-axes
  // prose), NOT a cascade copy of `template/README.md` — that template file is
  // the `<REPO_NAME>` placeholder fresh repos adopt, a DIFFERENT file. The
  // cascade synthesizes each downstream README from the placeholder + per-repo
  // data; it never overwrites the wheelhouse's own. So in the wheelhouse repo
  // (identified by the `template/CLAUDE.md` marker), editing root README.md is
  // legitimate authoring, not a downstream fork. Downstream repos still hit the
  // guard (they have no `template/`, so `isCanonicalRelativePath` already
  // returned false above for them anyway — this only matters in the wheelhouse).
  const relNormalized = normalizePath(relToRepo)
  if (relNormalized === 'README.md' && isWheelhouseRoot(repoRoot)) {
    return undefined
  }

  // Fleet-block allowance: a canonical file that carries `<fleet-canonical>`
  // open/close markers is only PART fleet-managed — content outside the markers
  // is repo-owned (e.g. a workflow's repo-specific jobs below the close marker).
  // Allow edits when the markers are present either on disk OR in the incoming
  // content, the bootstrap that first adds the markers. The sync's
  // workflow-fleet-block check re-validates the marked block at commit time, so
  // a fork INSIDE the block is still caught.
  if (hasFleetBlockMarkers(absPath) || textHasFleetBlockMarkers(content)) {
    return undefined
  }

  // Bypass-phrase check.
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  return block(
    [
      `🚨 no-fleet-fork-guard: blocked Edit/Write to fleet-canonical path.`,
      ``,
      `File:  ${relNormalized}`,
      `Repo:  ${path.basename(repoRoot)}`,
      ``,
      `Fleet-canonical files (anything tracked by`,
      `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts) MUST`,
      `be edited in socket-wheelhouse/template/${relNormalized} and`,
      `cascaded out — never branched locally in a downstream fleet repo.`,
      ``,
      `Fix path:`,
      `  1. Edit socket-wheelhouse/template/${relNormalized}`,
      `  2. Commit + push template`,
      `  3. Cascade with: node scripts/sync-scaffolding/cli.mts \\`,
      `       --target ${repoRoot} --fix`,
      ``,
      `If you genuinely need to bypass (e.g. emergency hotfix that`,
      `can't wait for cascade), the user must type \`${BYPASS_PHRASE}\``,
      `verbatim in a recent user turn. Reference:`,
      `docs/agents.md/fleet/no-local-fork.md`,
      ``,
    ].join('\n'),
  )
}

export const check = editGuard(fleetForkVerdict)

// Commands whose LAST bare (non-flag) argument is the write destination —
// every argument before it is a source. Mirrors the same shape
// no-upstream-edit-guard tracks for its own upstream/-write detection.
const WRITE_DEST_ARG = new Set(['cp', 'install', 'mv'])

// Commands where EVERY bare (non-flag) argument is itself a write
// destination — `tee` streams stdin to each named file (plus stdout), so
// there's no separate "source" argument to exclude.
const WRITE_ALL_ARGS = new Set(['tee'])

// Redirect ops shell-quote can emit. Mirrors shell-command.mts's
// `REDIRECT_OPS` — duplicated (not imported) because only `>`/`>>`/`&>`/`&>>`
// are WRITE destinations here; the rest (`<`, `<<`, `2>&1`, …) still need
// their operand skipped so it doesn't leak into the segment's bare-arg list.
const REDIRECT_OPS = new Set([
  '&>',
  '&>>',
  '<',
  '<&',
  '<<',
  '<<<',
  '<>',
  '>',
  '>&',
  '>>',
])

// The subset of REDIRECT_OPS that write a file (stdout/stderr → file).
const WRITE_REDIRECT_OPS = new Set(['&>', '&>>', '>', '>>'])

const COMMAND_SEPARATOR_OPS = new Set(['\n', ';', '&', '&&', '|', '||'])

const FD_DIGIT_RE = /^\d+$/

function isParseOp(e: ParseEntry): e is { op: string } {
  return typeof e === 'object' && e !== null && 'op' in e
}

function isParseComment(e: ParseEntry): e is { comment: string } {
  return typeof e === 'object' && e !== null && 'comment' in e
}

// The write-destination arg(s) of one already-tokenized command segment
// (binary + args; leading `NAME=value` assignments are skipped inline).
function destinationsInSegment(tokens: readonly string[]): string[] {
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    i += 1
  }
  const binary = tokens[i]
  if (!binary) {
    return []
  }
  const bare = tokens.slice(i + 1).filter(t => t !== '' && !t.startsWith('-'))
  if (WRITE_ALL_ARGS.has(binary)) {
    return bare
  }
  if (WRITE_DEST_ARG.has(binary) && bare.length > 0) {
    return [bare[bare.length - 1]!]
  }
  return []
}

/**
 * Every path a shell command would WRITE to: a `cp`/`mv`/`install`
 * destination, every `tee` target, and every `>`/`>>`/`&>`/`&>>` redirect
 * target. Returns the raw path strings exactly as they appear in the
 * command — not resolved to absolute — the caller resolves each against the
 * command's effective working directory. A trailing-directory destination
 * (`cp src dst/`) is returned as-is; `normalizePath` strips the trailing
 * slash before the canonical-path prefix check, so a directory destination
 * that sits inside (or IS) a canonical dir is still caught without needing
 * the source's basename appended.
 *
 * Built directly on `parseShell`, not the `parseCommands` wrapper in
 * `shell-command.mts`: that wrapper deliberately DISCARDS a redirect's target
 * token (the right call for guards that only care about a segment's binary +
 * args), which is exactly the token this function needs.
 */
export function extractBashWriteDestinations(command: string): string[] {
  let entries: ParseEntry[]
  try {
    entries = parseShell(normalizeNewlineSeparators(command))
  } catch {
    /* c8 ignore start - shell-quote does not throw on string inputs; bashGuard guarantees a string */
    return []
    /* c8 ignore stop */
  }

  const destinations: string[] = []
  let tokens: string[] = []

  const flush = (): void => {
    destinations.push(...destinationsInSegment(tokens))
    tokens = []
  }

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (isParseComment(e)) {
      continue
    }
    if (isParseOp(e)) {
      if (COMMAND_SEPARATOR_OPS.has(e.op) || e.op === '(' || e.op === ')') {
        flush()
        continue
      }
      if (REDIRECT_OPS.has(e.op)) {
        // Drop a preceding bare fd digit (`2>&1` → `'2'` sits in tokens right
        // before the op) — it's a file descriptor, not a command argument.
        if (tokens.length > 0 && FD_DIGIT_RE.test(tokens[tokens.length - 1]!)) {
          tokens.pop()
        }
        const next = entries[i + 1]
        const hasOperand =
          next !== undefined && !isParseOp(next) && !isParseComment(next)
        if (
          WRITE_REDIRECT_OPS.has(e.op) &&
          hasOperand &&
          typeof next === 'string' &&
          next !== ''
        ) {
          destinations.push(next)
        }
        if (hasOperand) {
          i += 1
        }
        continue
      }
      // The `$` substitution sigil and similar — plain indirection, ignore.
      continue
    }
    if (typeof e !== 'string' || e === '') {
      // A bare '' is a `$VAR`/`${VAR}` placeholder collapsed by shell-quote —
      // its value can't be resolved statically, so it can't be judged a write
      // destination either. Drop it rather than mis-position a later arg.
      continue
    }
    tokens.push(e)
  }
  flush()
  return destinations
}

/**
 * The Bash counterpart of `fleetForkVerdict`: extract every write destination
 * from the command, resolve each against the command's effective working
 * directory (`cd <dir> &&` / `git -C <dir>`, else the session cwd), and run it
 * through the same decision engine an Edit/Write hits. Content is passed as
 * `''` — a Bash write has no known post-write text, so the on-disk
 * `hasFleetBlockMarkers` allowance still applies by reading the real file,
 * while the incoming-content `textHasFleetBlockMarkers` allowance never fires.
 * That is the conservative direction: a Bash write can't claim "I'm
 * bootstrapping the fleet-block markers" the way an Edit/Write legitimately
 * can.
 */
export const bashCheck = bashGuard((command, payload) => {
  const destinations = extractBashWriteDestinations(command)
  if (destinations.length === 0) {
    return undefined
  }
  const cwd = commandWorkingDir(command)
  for (let i = 0, { length } = destinations; i < length; i += 1) {
    const abs = path.resolve(cwd, destinations[i]!)
    const verdict = fleetForkVerdict(abs, '', payload)
    if (verdict) {
      return verdict
    }
  }
  return undefined
})
