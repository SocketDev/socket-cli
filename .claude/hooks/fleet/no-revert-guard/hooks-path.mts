/*
 * @file The third hook-chain escape: pointing `core.hooksPath` somewhere the
 *   fleet's `.git-hooks/` chain is not, for the duration of one `git`
 *   invocation. `--no-verify` and `HUSKY=0` are both phrase-gated in
 *   `index.mts`; this closes the route that reaches the same outcome through
 *   git's config layer.
 *
 *   Three spellings reach the setting, all handled here:
 *
 *   - `-c core.hooksPath=<path>` (separated or `-c`-attached).
 *   - `--config-env=core.hooksPath=<VAR>` (separated or `=`-joined), which
 *     takes the value from an environment variable.
 *   - `GIT_CONFIG_COUNT=<n> GIT_CONFIG_KEY_<i>=core.hooksPath
 *     GIT_CONFIG_VALUE_<i>=<path>` as inline assignments or an `export` in the
 *     same Bash payload.
 *
 *   Known miss, stated rather than papered over: a `GIT_CONFIG_KEY_<i>`
 *   exported in an EARLIER Bash call is invisible here — a PreToolUse hook
 *   sees one command string, not the shell's accumulated environment. So is a
 *   `GIT_CONFIG_GLOBAL` / `GIT_DIR` pointed at a config file that carries the
 *   key, and a persisted `git config core.hooksPath <path>` (a config WRITE,
 *   owned by `git-config-write-guard`, not a per-invocation override).
 *
 *   The value is NOT the discriminator. An empty `-c core.hooksPath=` disables
 *   hooks just as completely as `/dev/null` does, so exempting the empty form
 *   would hand the bypass straight back. What separates the fleet's own
 *   hardening idiom (`docs/agents.md/fleet/untrusted-cwd.md`: a git spawn
 *   against a repository the tool does not own carries `-c core.hooksPath=` so
 *   a hostile checkout's hooks cannot run) from an operator skipping fleet
 *   gates is WHICH REPOSITORY the invocation targets:
 *
 *   - The hardening idiom lives in TypeScript that spawns git directly, so it
 *     is never a Bash payload and this guard never sees it.
 *   - Hand-run against a scanned checkout it names that checkout — via `cd`
 *     (which `isFleetTarget` already follows, standing the whole `fleetOnly`
 *     check down outside the fleet) or via `-C` / `--git-dir` (which
 *     `namesForeignRepo` follows here).
 *   - `-C packages/cli` names a subdirectory of THIS repo, so it is not a
 *     foreign target and stays blocked.
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { gitOut } from '../_shared/git-branch.mts'
import { splitGitSubcommand } from '../_shared/git-subcommand.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import type { Command } from '../_shared/shell-command.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

/**
 * The `git` subcommands that consult `core.hooksPath`, verified by running
 * each one against a temp repo whose hooks log their own name:
 *
 * - `commit` → pre-commit, prepare-commit-msg, commit-msg, post-commit
 * - `merge` → pre-merge-commit, prepare-commit-msg, commit-msg, post-merge
 * - `cherry-pick` → prepare-commit-msg, post-commit
 * - `revert` → prepare-commit-msg, post-commit
 * - `rebase` → pre-rebase, post-checkout, post-commit, post-rewrite
 * - `am` → applypatch-msg, pre-applypatch, post-applypatch
 * - `push` → pre-push
 * - `pull` → whichever of merge / rebase it delegates to
 *
 * `checkout`, `switch`, `clone`, and `worktree add` reach only `post-checkout`,
 * which the fleet chain does not ship — and `clone -c core.hooksPath=` IS the
 * hardening idiom for a hostile remote, so listing them would block the very
 * pattern `untrusted-cwd.md` mandates. `status`, `rev-parse`, `ls-remote`, and
 * every other read run no hooks at all.
 */
export const HOOK_RUNNING_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'am',
  'cherry-pick',
  'commit',
  'merge',
  'pull',
  'push',
  'rebase',
  'revert',
])

// git config keys are case-insensitive in their section and variable names, so
// `core.hookspath` and `CORE.HooksPath` set the same thing.
const HOOKS_PATH_KEY = /^core\.hookspath=/i
const CONFIG_ENV_HOOKS_PATH = /^--config-env=core\.hookspath=/i
const C_ATTACHED_HOOKS_PATH = /^-ccore\.hookspath=/i
const GIT_CONFIG_KEY_ASSIGNMENT = /^GIT_CONFIG_KEY_\d+=(.+)$/
const HOOKS_PATH_VALUE = /^core\.hookspath$/i

/**
 * The `git` global options that precede a segment's subcommand — the only
 * place a `-c` / `--config-env` override can sit. A `-c` AFTER the subcommand
 * belongs to the subcommand (`git commit -c <commit>` reuses a message), and a
 * `core.hooksPath=` string inside a commit message is prose, not a setting.
 */
export function gitGlobalArgs(args: readonly string[]): readonly string[] {
  const { rest, sub } = splitGitSubcommand(args)
  if (sub === undefined) {
    return args
  }
  return args.slice(0, args.length - rest.length - 1)
}

/**
 * The `core.hooksPath` override a segment's global options carry, as the
 * offending token for the block message, or undefined when they carry none.
 */
export function hooksPathGlobalOverride(
  args: readonly string[],
): string | undefined {
  const globals = gitGlobalArgs(args)
  for (let i = 0, { length } = globals; i < length; i += 1) {
    const arg = globals[i]!
    if (CONFIG_ENV_HOOKS_PATH.test(arg) || C_ATTACHED_HOOKS_PATH.test(arg)) {
      return arg
    }
    if (arg === '--config-env' || arg === '-c') {
      const value = globals[i + 1]
      if (value !== undefined && HOOKS_PATH_KEY.test(value)) {
        return `${arg} ${value}`
      }
    }
  }
  return undefined
}

/**
 * The `GIT_CONFIG_KEY_<i>=core.hooksPath` assignment anywhere in a parsed
 * command line — an inline env prefix on the `git` segment, or an `export` in
 * an earlier segment of the same payload.
 */
export function hooksPathEnvOverride(
  commands: readonly Command[],
): string | undefined {
  for (const cmd of commands) {
    const tokens =
      cmd.binary === 'export'
        ? [...cmd.assignments, ...cmd.args]
        : cmd.assignments
    for (const token of tokens) {
      const match = GIT_CONFIG_KEY_ASSIGNMENT.exec(token)
      if (match && HOOKS_PATH_VALUE.test(match[1]!)) {
        return token
      }
    }
  }
  return undefined
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(normalizePath(root), normalizePath(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * True when a segment's `-C <dir>` / `--git-dir <dir>` points OUTSIDE the repo
 * the payload acts on — the shape of a git spawn hardened against a scanned
 * checkout it does not own.
 *
 * Fails CLOSED: when either the acting repo root or the named directory cannot
 * be resolved, the answer is "not foreign", so an unresolvable path can never
 * manufacture an exemption.
 */
export function namesForeignRepo(
  args: readonly string[],
  payload: ToolCallPayload,
): boolean {
  const globals = gitGlobalArgs(args)
  const named: string[] = []
  for (let i = 0, { length } = globals; i < length; i += 1) {
    const arg = globals[i]!
    if (arg === '--git-dir' || arg === '-C') {
      const value = globals[i + 1]
      if (value !== undefined) {
        named.push(value)
      }
      i += 1
      continue
    }
    if (arg.startsWith('--git-dir=')) {
      named.push(arg.slice('--git-dir='.length))
    }
  }
  if (named.length === 0) {
    return false
  }
  const base = actedOnPath(payload)
  const root = gitOut(base, ['rev-parse', '--show-toplevel'])?.trim()
  if (!root) {
    return false
  }
  return named.every(dir => !isWithin(root, path.resolve(base, dir)))
}

/**
 * The `core.hooksPath` skip a command performs, as the offending token, or
 * undefined when it performs none.
 */
export function matchHooksPathSkip(
  command: string,
  payload: ToolCallPayload,
): string | undefined {
  if (!/hookspath|GIT_CONFIG_KEY_/i.test(command)) {
    return undefined
  }
  const commands = parseCommands(command)
  const envOverride = hooksPathEnvOverride(commands)
  for (const cmd of commands) {
    if (cmd.binary !== 'git') {
      continue
    }
    const { sub } = splitGitSubcommand(cmd.args)
    if (sub === undefined || !HOOK_RUNNING_GIT_SUBCOMMANDS.has(sub)) {
      continue
    }
    const override = hooksPathGlobalOverride(cmd.args) ?? envOverride
    if (override === undefined) {
      continue
    }
    if (namesForeignRepo(cmd.args, payload)) {
      continue
    }
    return `git ${sub} with ${override}`
  }
  return undefined
}
