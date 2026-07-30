#!/usr/bin/env node
// Claude Code PreToolUse hook — no-copyleft-source-read.
//
// BLOCKS every route an agent has to the IMPLEMENTATION of a copyleft upstream.
// A copyleft project may be RUN as a tool and OBSERVED through its own tests —
// behavior is not implementation — but reading, copying, or deriving from its
// source makes the consuming package a derivative work and forces the
// upstream's license onto it. The roster, the tests allowlist, and the matcher
// all live in `_shared/copyleft-upstreams.mts`, which the commit-time belt
// `copyleft-slices-are-tests-only.mts` shares, so guard and gate cannot drift.
//
// STRUCTURE IS NOT CONTENT. A directory tree — paths, file names, blob shas,
// counts — is FACT, not expression, and copyright does not reach it. Only the
// code itself is off limits. So enumeration is ALLOWED everywhere and only
// content reads are blocked. Conflating the two is not merely over-strict, it
// is actively harmful: it blocks the very listing needed to verify that a
// roster entry's tests allowlist matches the upstream's real test corpus, so
// the guard's own data silently rots behind the guard.
//
// ALLOWED — enumeration, yields paths and names, never file bytes:
//   - `ls` at any depth, `tree`, `find` with name-style output.
//   - `git ls-tree` / `git ls-files`; a blob sha names a blob, it is not one.
//   - `gh api repos/<o>/<r>/git/trees/<sha>` — the remote tree listing.
//   - The Glob tool; its results ARE paths, including a bare submodule-root
//     pattern such as `upstream/<repo>/**`.
//   - Read of a DIRECTORY, which yields an entry listing rather than content.
//   - `rg -l` / `grep -l` / `--files-with-matches` / `--count` — path-only
//     output. See docs/agents.md/fleet/copyleft-boundaries.md for why the
//     theoretical content-oracle in `-l` is accepted rather than blocked.
//
// BLOCKED — content:
//   - Read of a non-test FILE under `upstream/<repo>/`.
//   - `cat` / `head` / `tail` / `less` / `strings` and equivalents on a
//     non-test file, whether named directly or reached by a leading `cd`.
//   - `rg` / `grep` in default LINE-PRINTING mode against a non-test scope;
//     matching lines are content. The Grep tool likewise blocks only when
//     `output_mode` is `content`.
//   - `find … -exec`/`-execdir`/`-ok`, which runs an arbitrary reader per hit.
//   - `git show <rev>:<non-test-path>`, `git cat-file` of a non-test blob, and
//     `git archive`. `git show HEAD:<dir>` prints a tree listing rather than
//     content, but the guard cannot tell a dir from a file in a rev-spec, so it
//     stays blocked and `git ls-tree` is the sanctioned enumeration route.
//   - `gh api repos/<owner>/<repo>/contents/<path>` for a non-test path.
//   - `curl` / `wget` against `raw.githubusercontent.com`, a
//     `github.com/<o>/<r>/{blob,raw}` file view, or a whole-tree archive from
//     `codeload.github.com` / `/archive` / `/tarball` / `/zipball`.
//   - `git sparse-checkout set|add|disable|reapply` that would WIDEN a copyleft
//     submodule's cone past its tests allowlist. This is the route that matters
//     most: widening the cone materializes the implementation on disk, after
//     which every later read looks like an ordinary local file.
//   - WebFetch of the same URLs. WebSearch carries a query, not a fetchable
//     URL, so there is nothing for this guard to match on it; the URL its
//     results lead to arrives as a WebFetch and is gated there.
//
// Fails open on parse errors — a guard bug must never wedge a session.
//
// Convention: docs/agents.md/fleet/copyleft-boundaries.md.
// Bypass: `Allow copyleft-source-read bypass`.

import { statSync } from 'node:fs'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  copyleftSparseRecipe,
  detectCopyleftImplementationRead,
  detectCopyleftScopeRead,
  detectCopyleftUrlRead,
  findCopyleftUpstreamByRepo,
  isCopyleftObservablePath,
  isCopyleftSparsePatternAllowed,
} from '../_shared/copyleft-upstreams.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  commandsFor,
  commandWorkingDir,
  parseCommands,
} from '../_shared/shell-command.mts'

import type {
  CopyleftReadFinding,
  CopyleftUpstream,
} from '../_shared/copyleft-upstreams.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Pre-flight keywords the dispatcher tests against the raw payload before
// importing this hook. Every route names its upstream — the submodule dir, the
// URL, the gh-api slug all carry the repo name — so the roster's repo names
// plus the `upstream/` prefix cover the surface. The literal array is
// load-bearing: gen/hook-dispatch.mts parses these tokens STATICALLY out of the
// source, so a computed list would read as no triggers at all. A test asserts
// every roster entry's repo name appears here.
export const triggers: readonly string[] = ['trufflehog', 'upstream/']

// git subcommands that stream a blob or a tree out of a repository.
const GIT_READ_SUBCOMMANDS = new Set(['archive', 'cat-file', 'show'])
// git sparse-checkout operations that can widen a cone.
const GIT_SPARSE_WIDENING = new Set(['add', 'disable', 'reapply', 'set'])
// Fetchers whose arguments are URLs.
const URL_FETCHERS: readonly string[] = ['curl', 'wget']
// Binaries that stream a file's BYTES to stdout. Every bare path operand is a
// content read. `ls` / `tree` / `find` are deliberately absent — they emit
// names, which is structure.
const CONTENT_READERS = new Set([
  'bat',
  'cat',
  'head',
  'less',
  'more',
  'nl',
  'od',
  'strings',
  'tail',
  'xxd',
])
// Search binaries that print MATCHING LINES by default. Lines are content, so
// these block unless a flag reduces the output to paths.
const SEARCH_BINARIES = new Set(['grep', 'rg', 'ripgrep'])
// Flags that reduce a search to paths, or to per-path tallies — the same
// information class as a directory listing. `-L` is absent on purpose: it means
// files-without-match in grep but follow-symlinks in rg, and a flag that blocks
// in one tool and not the other is worse than requiring the long spelling.
const SEARCH_PATH_ONLY_FLAGS = new Set([
  '--count',
  '--files',
  '--files-with-matches',
  '--files-without-match',
  '-c',
  '-l',
])
// `find` actions that hand each hit to an arbitrary command, which is how a
// name-only walk turns into a content read.
const FIND_EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir'])

/**
 * A blocked copyleft read: the finding plus the human label for HOW it was
 * reached, which becomes the message's Where line.
 */
export interface CopyleftBlock {
  readonly finding: CopyleftReadFinding
  readonly how: string
}

// The copyleft upstream a directory sits inside, or undefined. Used for the
// git routes, where the submodule is named by `-C`/`cd` rather than by the
// path argument.
function copyleftUpstreamForDir(dir: string): CopyleftUpstream | undefined {
  const normalized = normalizePath(dir).replace(/\/+$/, '')
  // `(?:^|\/)upstream\/` anchors the segment so `my-upstream/` cannot match;
  // `([^/]+)` is the submodule directory name.
  const match = /(?:^|\/)upstream\/([^/]+)(?:\/|$)/.exec(normalized)
  return match ? findCopyleftUpstreamByRepo(match[1]!) : undefined
}

// The blob path inside a `git show`/`git cat-file` revision argument. Both
// accept `<rev>:<path>`; a bare `<rev>` names no path.
function blobPathInRevision(arg: string): string | undefined {
  const colon = arg.indexOf(':')
  return colon === -1 ? undefined : arg.slice(colon + 1)
}

// Pre-subcommand git flags that CONSUME the next token. Their value is a bare
// token, so a naive non-flag filter would read `git -C <dir> show` as the
// subcommand `<dir>` and miss the read entirely.
const GIT_FLAGS_WITH_VALUE = new Set(['--git-dir', '--work-tree', '-C', '-c'])

// The bare, non-flag tokens of a parsed git command's argument list, with the
// values of value-taking global flags removed so `bare[0]` is the subcommand.
function bareArgs(args: readonly string[]): string[] {
  const bare: string[] = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (GIT_FLAGS_WITH_VALUE.has(arg)) {
      i += 1
      continue
    }
    if (!arg.startsWith('-')) {
      bare.push(arg)
    }
  }
  return bare
}

/**
 * Detect a `git show` / `git cat-file` / `git archive` that would stream a
 * copyleft implementation. The submodule is resolved from the command's
 * effective working directory first — `git -C upstream/<repo>` and a leading
 * `cd` both land there — and otherwise from an `upstream/<repo>/…` path typed
 * into the arguments themselves.
 */
export function detectCopyleftGitRead(
  command: string,
): CopyleftBlock | undefined {
  const cwdUpstream = copyleftUpstreamForDir(commandWorkingDir(command))
  const gitCmds = commandsFor(command, 'git')
  for (let i = 0, { length } = gitCmds; i < length; i += 1) {
    const bare = bareArgs(gitCmds[i]!.args)
    const sub = bare[0]
    if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) {
      continue
    }
    // `git archive` streams the whole tree; no revision path narrows it enough
    // to be observable, so any copyleft target is a block.
    if (sub === 'archive' && cwdUpstream) {
      return {
        finding: { path: '', route: 'submodule-path', upstream: cwdUpstream },
        how: 'a `git archive` of the whole tree',
      }
    }
    for (let j = 1, { length: blen } = bare; j < blen; j += 1) {
      const arg = bare[j]!
      // An `upstream/<repo>/…` path typed directly into the arguments.
      const direct = detectCopyleftImplementationRead(arg)
      if (direct) {
        return { finding: direct, how: `a \`git ${sub}\`` }
      }
      const blobPath = blobPathInRevision(arg)
      if (
        cwdUpstream &&
        blobPath !== undefined &&
        !isCopyleftObservablePath(cwdUpstream, blobPath)
      ) {
        return {
          finding: {
            path: blobPath,
            route: 'submodule-path',
            upstream: cwdUpstream,
          },
          how: `a \`git ${sub}\` of a tracked blob`,
        }
      }
    }
  }
  return undefined
}

// The copyleft upstream named by any bare token of a sparse-checkout command,
// for the `git sparse-checkout … upstream/<repo>` spelling that does not go
// through `-C` or a leading `cd`.
function sparseTargetInArgs(
  bare: readonly string[],
): CopyleftUpstream | undefined {
  for (let i = 2, { length } = bare; i < length; i += 1) {
    const hit = copyleftUpstreamForDir(bare[i]!)
    if (hit) {
      return hit
    }
  }
  return undefined
}

/**
 * Detect a `git sparse-checkout` operation that would widen a copyleft
 * submodule's cone past its tests allowlist. `disable` and `reapply` are
 * blocked outright: `disable` restores the FULL tree by definition, and
 * `reapply` re-materializes whatever the on-disk cone config currently says —
 * which the guard cannot prove is still the tests slice. Re-establishing the
 * sanctioned cone with an explicit `set` is the allowed path, and it is exactly
 * the command the Fix line hands back.
 */
export function detectCopyleftSparseWiden(
  command: string,
): CopyleftBlock | undefined {
  const cwdUpstream = copyleftUpstreamForDir(commandWorkingDir(command))
  const gitCmds = commandsFor(command, 'git')
  for (let i = 0, { length } = gitCmds; i < length; i += 1) {
    const bare = bareArgs(gitCmds[i]!.args)
    if (bare[0] !== 'sparse-checkout') {
      continue
    }
    const op = bare[1]
    if (!op || !GIT_SPARSE_WIDENING.has(op)) {
      continue
    }
    const target = cwdUpstream ?? sparseTargetInArgs(bare)
    if (!target) {
      continue
    }
    if (op === 'disable' || op === 'reapply') {
      return {
        finding: { path: '', route: 'sparse-widen', upstream: target },
        how: `a \`git sparse-checkout ${op}\``,
      }
    }
    for (let j = 2, { length: blen } = bare; j < blen; j += 1) {
      if (!isCopyleftSparsePatternAllowed(target, bare[j]!)) {
        return {
          finding: { path: bare[j]!, route: 'sparse-widen', upstream: target },
          how: `a \`git sparse-checkout ${op}\` pattern`,
        }
      }
    }
  }
  return undefined
}

// A path operand judged as a FILE read, tried both as typed and as resolved
// against the command's working dir, so `cd upstream/<repo> && cat pkg/x.go`
// is caught even though the operand carries no `upstream/` segment.
function copyleftFileFinding(
  cwd: string,
  arg: string,
): CopyleftReadFinding | undefined {
  return (
    detectCopyleftImplementationRead(arg) ??
    detectCopyleftImplementationRead(`${cwd}/${arg}`)
  )
}

// The same, judged as a SEARCH SCOPE: a directory operand counts because a
// recursive search under it reads every file it holds.
function copyleftScopeFinding(
  cwd: string,
  arg: string,
): CopyleftReadFinding | undefined {
  return (
    detectCopyleftScopeRead(arg) ?? detectCopyleftScopeRead(`${cwd}/${arg}`)
  )
}

/**
 * True when a search invocation prints only paths or tallies. Covers the long
 * flags, the bare `-l`/`-c`, and a short-flag cluster such as `-rl` / `-ln`.
 */
export function isPathOnlySearch(args: readonly string[]): boolean {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (SEARCH_PATH_ONLY_FLAGS.has(arg)) {
      return true
    }
    // `^-[A-Za-z]+$` is a short-flag cluster, no `--` and no `=value`; an `l`
    // anywhere inside it is the files-with-matches flag.
    if (/^-[A-Za-z]+$/.test(arg) && arg.includes('l')) {
      return true
    }
  }
  return false
}

/**
 * Detect a LOCAL content read of a copyleft implementation: a `cat`-family
 * reader on a non-test file, a line-printing `grep`/`rg` over a non-test scope,
 * or a `find … -exec` that hands each hit to an arbitrary command.
 *
 * Enumeration passes straight through — `ls`, `tree`, a name-only `find`, and
 * `git ls-tree`/`ls-files` are never in scope here.
 */
export function detectCopyleftContentRead(
  command: string,
): CopyleftBlock | undefined {
  const cwd = commandWorkingDir(command)
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const cmd = commands[i]!
    const bare = cmd.args.filter(a => !a.startsWith('-'))
    if (CONTENT_READERS.has(cmd.binary)) {
      for (let j = 0, { length: blen } = bare; j < blen; j += 1) {
        const finding = copyleftFileFinding(cwd, bare[j]!)
        if (finding) {
          return { finding, how: `a \`${cmd.binary}\`` }
        }
      }
    } else if (SEARCH_BINARIES.has(cmd.binary)) {
      if (isPathOnlySearch(cmd.args)) {
        continue
      }
      // The first bare operand is the PATTERN unless `-e`/`--regexp` supplied
      // it, so skipping it keeps a search FOR the text of an upstream path from
      // reading as a search INSIDE that path.
      const patternIsFlagged =
        cmd.args.includes('-e') || cmd.args.includes('--regexp')
      for (
        let j = patternIsFlagged ? 0 : 1, { length: blen } = bare;
        j < blen;
        j += 1
      ) {
        const finding = copyleftScopeFinding(cwd, bare[j]!)
        if (finding) {
          return { finding, how: `a line-printing \`${cmd.binary}\`` }
        }
      }
    } else if (cmd.binary === 'find') {
      if (!cmd.args.some(a => FIND_EXEC_ACTIONS.has(a))) {
        continue
      }
      for (let j = 0, { length: blen } = bare; j < blen; j += 1) {
        const finding = copyleftScopeFinding(cwd, bare[j]!)
        if (finding) {
          return { finding, how: 'a `find … -exec`' }
        }
      }
    }
  }
  return undefined
}

/**
 * Detect a Bash network read of a copyleft implementation: a `gh api
 * repos/<o>/<r>/contents/<path>` call, or a `curl`/`wget` against a raw blob,
 * a `github.com` file view, or a whole-tree archive.
 */
export function detectCopyleftNetworkRead(
  command: string,
): CopyleftBlock | undefined {
  const ghCmds = commandsFor(command, 'gh')
  for (let i = 0, { length } = ghCmds; i < length; i += 1) {
    const { args } = ghCmds[i]!
    if (args[0] !== 'api') {
      continue
    }
    for (let j = 1, { length: alen } = args; j < alen; j += 1) {
      const finding = detectCopyleftUrlRead(args[j]!)
      if (finding) {
        return { finding, how: 'a `gh api` contents read' }
      }
    }
  }
  for (let i = 0, { length } = URL_FETCHERS; i < length; i += 1) {
    const fetcher = URL_FETCHERS[i]!
    const cmds = commandsFor(command, fetcher)
    for (let j = 0, { length: clen } = cmds; j < clen; j += 1) {
      const { args } = cmds[j]!
      for (let k = 0, { length: alen } = args; k < alen; k += 1) {
        const finding = detectCopyleftUrlRead(args[k]!)
        if (finding) {
          return { finding, how: `a \`${fetcher}\` download` }
        }
      }
    }
  }
  return undefined
}

/**
 * The full Bash surface: network fetch, git blob/tree read, sparse-cone widen.
 */
export function detectCopyleftBashRead(
  command: string,
): CopyleftBlock | undefined {
  return (
    detectCopyleftNetworkRead(command) ??
    detectCopyleftSparseWiden(command) ??
    detectCopyleftGitRead(command) ??
    detectCopyleftContentRead(command)
  )
}

/**
 * The block message: What / Where / Saw vs. wanted / Fix, naming the SPDX id,
 * the tests-only rule, and the permissive alternative when one is recorded.
 */
export function formatCopyleftBlock(detection: CopyleftBlock): string {
  const { finding, how } = detection
  const { upstream } = finding
  const slug = `${upstream.owner}/${upstream.repo}`
  const where =
    finding.path === ''
      ? `  Where: ${how} covering the whole \`${slug}\` tree.`
      : `  Where: ${how} targeting \`${finding.path}\` in \`${slug}\`.`
  const lines = [
    `[no-copyleft-source-read] Blocked: reading ${slug} implementation, ${upstream.spdx}.`,
    '',
    `  What:  ${slug} is ${upstream.spdx} copyleft. Reading, copying, or`,
    '         deriving from its implementation makes the consuming package a',
    '         derivative work and forces that license onto it.',
    where,
    '  Wanted: run it as a tool and observe it through its OWN tests —',
    `         ${upstream.testPathPatterns.join(', ')} — and nothing else.`,
    '  Fix:   derive from a permissively licensed source instead, and keep the',
    '         submodule cone tests-only:',
    `           ${copyleftSparseRecipe(upstream)}`,
    '         Enumerating the tree is FINE — structure is fact, not expression.',
    '         Use `ls` / `tree` / `find`, `git ls-tree`, Glob, a directory Read,',
    '         or `rg -l` when you need to know what is there.',
  ]
  if (upstream.permissiveAlternative) {
    lines.push(
      `         Recorded permissive alternative: ${upstream.permissiveAlternative}.`,
    )
  }
  lines.push('         See docs/agents.md/fleet/copyleft-boundaries.md.')
  return `${lines.join('\n')}\n`
}

// Read narrows to one file; Grep/Glob narrow to a scope, so the scope matcher
// runs for them.
/**
 * True when a Read targets a DIRECTORY, whose result is an entry listing rather
 * than file bytes. Structure is fact, so a directory Read is enumeration and
 * passes. A path that cannot be stat'd is treated as a file: that is the
 * fail-safe side, and a Read of a nonexistent path errors on its own anyway.
 */
export function isDirectoryRead(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

// Grep's `output_mode`: 'content' prints matching LINES, which is content.
// 'files_with_matches' — the tool's DEFAULT — and 'count' emit paths and
// tallies, the same information class as a listing.
function grepPrintsContent(input: ToolCallPayload['tool_input']): boolean {
  return input?.output_mode === 'content'
}

function checkReadTools(payload: ToolCallPayload): GuardResult {
  const tool = payload?.tool_name
  const input = payload?.tool_input
  if (tool === 'Read') {
    const filePath = typeof input?.file_path === 'string' ? input.file_path : ''
    // Listing a directory inside the submodule is enumeration, not a read.
    if (isDirectoryRead(filePath)) {
      return undefined
    }
    const finding = detectCopyleftImplementationRead(filePath)
    return finding
      ? block(formatCopyleftBlock({ finding, how: 'a Read' }))
      : undefined
  }
  // Glob is never gated: its results ARE paths, so even a bare
  // `upstream/<repo>/**` is a listing.
  if (tool !== 'Grep' || !grepPrintsContent(input)) {
    return undefined
  }
  const searchPath = typeof input?.path === 'string' ? input.path : undefined
  if (searchPath) {
    const finding = detectCopyleftScopeRead(searchPath)
    if (finding) {
      return block(
        formatCopyleftBlock({ finding, how: 'a line-printing Grep scope' }),
      )
    }
  }
  return undefined
}

function checkWebFetch(payload: ToolCallPayload): GuardResult {
  if (payload?.tool_name !== 'WebFetch') {
    return undefined
  }
  const url = payload?.tool_input?.url
  if (typeof url !== 'string') {
    return undefined
  }
  const finding = detectCopyleftUrlRead(url)
  return finding
    ? block(formatCopyleftBlock({ finding, how: 'a WebFetch' }))
    : undefined
}

const bashCheck = bashGuard(command => {
  const detection = detectCopyleftBashRead(command)
  return detection ? block(formatCopyleftBlock(detection)) : undefined
})

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  return (
    checkReadTools(payload) ??
    checkWebFetch(payload) ??
    (await bashCheck(payload))
  )
}

export const hook = defineHook({
  bypass: ['copyleft-source-read'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Grep', 'Read', 'WebFetch'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
