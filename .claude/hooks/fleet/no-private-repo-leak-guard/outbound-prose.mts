/*
 * @file Extract the OUTBOUND PROSE and the WRITE TARGET from a parsed `gh`
 *   command segment, for `no-private-repo-leak-guard`.
 *
 *   "Outbound prose" is every string the command would publish where a human
 *   can read it: PR / issue / review bodies and titles, release notes, `gh api`
 *   REST field values, GraphQL `query=` documents, and the contents a
 *   `--body-file` / `--notes-file` / `--input` / `@file` argument points at.
 *
 *   Everything reads off the shell-quote-backed AST (`_shared/shell-command.mts`),
 *   never a regex over the raw command line: a `--body` mentioned inside an
 *   unrelated `grep` pattern is not outbound prose, and an `&&` chain or `$(…)`
 *   substitution must not smear one segment's flags onto another.
 *
 *   A prose source the guard cannot READ (a `--body-file -` fed from stdin, an
 *   absent path) contributes nothing. That single narrow gap is deliberate and
 *   is NOT the fail-closed axis: the roster is (see `roster.mts`). Blocking
 *   every heredoc-piped body would make the guard unusable, whereas an
 *   unresolvable ROSTER means the guard cannot certify prose it CAN read.
 */

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'
import { GH_VALUE_FLAGS } from '@socketsecurity/lib-stable/shell/command-args'

import { positionalArgs } from '../_shared/positional-args.mts'

import type { Command } from '../_shared/shell-command.mts'

/**
 * Largest file a prose source is read from. A `--body-file` pointing at a
 * multi-megabyte artifact is not prose; the cap keeps a tool call cheap.
 */
export const MAX_PROSE_FILE_BYTES = 256 * 1024

/**
 * `gh` flags whose next token is a value, extended past the shared
 * {@link GH_VALUE_FLAGS} table with the release / api / GraphQL flags this
 * guard has to walk past when locating positional arguments.
 */
export const GH_LEAK_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...GH_VALUE_FLAGS,
  '--cache',
  '--field',
  '--hostname',
  '--input',
  '--jq',
  '--method',
  '--notes',
  '--notes-file',
  '--raw-field',
  '--template',
  '-X',
  '-f',
  '-n',
  '-q',
])

// Flags carrying literal prose on `gh pr|issue|release|gist` writes.
const TEXT_FLAGS: ReadonlySet<string> = new Set([
  '--body',
  '--notes',
  '--subject',
  '--title',
  '-b',
  '-n',
  '-t',
])

// Flags naming a FILE whose contents are published verbatim. `-F` is
// `--body-file` / `--notes-file` on every subcommand except `api`, where it is
// `--field`; the caller branches on the subcommand before consulting this.
const FILE_FLAGS: ReadonlySet<string> = new Set([
  '--body-file',
  '--input',
  '--notes-file',
  '-F',
])

// `gh api` field flags. Each value is `key=value`; a `@`-prefixed value reads
// the payload from a file. `query` is the GraphQL document key.
const API_FIELD_FLAGS: ReadonlySet<string> = new Set([
  '--field',
  '--raw-field',
  '-F',
  '-f',
])

// `gh api` flags naming a file holding the whole request body.
const API_FILE_FLAGS: ReadonlySet<string> = new Set(['--input'])

/**
 * One publishable string, with the argument it came from so the block message
 * can point the operator at the exact place to edit.
 */
export interface ProseSource {
  readonly label: string
  readonly text: string
}

/**
 * Reads a prose file's contents, or undefined when unreadable. Injected by
 * tests so no spec touches the real filesystem.
 */
export type ProseFileReader = (filePath: string) => string | undefined

/**
 * Default reader: resolve against the command's working directory, cap the
 * read, and treat every failure as "no prose here".
 */
export function readProseFile(
  filePath: string,
  workingDir: string,
): string | undefined {
  if (!filePath || filePath === '-') {
    return undefined
  }
  const resolved = path.resolve(workingDir, filePath)
  const text = safeReadFileSync(resolved)
  return typeof text === 'string'
    ? text.slice(0, MAX_PROSE_FILE_BYTES)
    : undefined
}

/**
 * The `gh` subcommand pair, e.g. `['pr', 'create']`. Value-taking flags and
 * the token each consumes are skipped, so `gh --repo o/r pr create` still
 * reports `pr create`.
 */
export function ghSubcommandWords(c: Command): string[] {
  return positionalArgs(c.args, GH_LEAK_VALUE_FLAGS, 2)
}

/**
 * Every value of `flag` on the segment, covering both the separate
 * (`--body text`) and `=`-joined (`--body=text`) spellings.
 *
 * Unlike `_shared/shell-command.mts`'s `flagValue`, a value that begins with
 * `-` is still accepted: a PR body legitimately opens with a markdown bullet
 * (`--body "- fixes the parser"`), and dropping it would blind the guard to the
 * most common body shape there is.
 */
export function flagValuesFor(args: readonly string[], flag: string): string[] {
  const values: string[] = []
  const joined = `${flag}=`
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === flag) {
      const next = args[i + 1]
      if (next !== undefined) {
        values.push(next)
        i += 1
      }
      continue
    }
    if (arg.startsWith(joined)) {
      values.push(arg.slice(joined.length))
    }
  }
  return values
}

/**
 * The `owner/repo` a REST endpoint path addresses, or undefined. Handles the
 * leading-slash, `repos/`-prefixed, and absolute-URL spellings `gh api`
 * accepts.
 */
export function repoFromApiEndpoint(endpoint: string): string | undefined {
  // `repos/<owner>/<repo>` anywhere in the endpoint, after an optional host and
  // leading slash. Owner/repo segments exclude `/` so the capture stops at the
  // next path element.
  const match = /(?:^|\/)repos\/([^/]+)\/([^/?#]+)/.exec(endpoint)
  return match ? `${match[1]}/${match[2]}` : undefined
}

/**
 * Split an `owner/repo` (or a full GitHub URL) into its two parts. The LAST two
 * path segments win, so `https://github.com/acme/ledger` and `acme/ledger` both
 * resolve to the same pair.
 */
export function splitOwnerRepo(
  target: string,
): { owner: string; repo: string } | undefined {
  const segments = target
    .replace(/\.git$/, '')
    .split('/')
    .filter(segment => segment && segment !== '.')
  if (segments.length < 2) {
    return undefined
  }
  const repo = segments[segments.length - 1]!
  const owner = segments[segments.length - 2]!
  if (owner.includes(':') || owner.includes('.')) {
    return undefined
  }
  return { owner, repo }
}

/**
 * The repository a `gh` segment writes to, as `owner/repo`, or undefined when
 * it is implied by the working directory rather than named on the command line.
 */
export function ghWriteTarget(c: Command): string | undefined {
  const explicit = [
    ...flagValuesFor(c.args, '--repo'),
    ...flagValuesFor(c.args, '-R'),
  ][0]
  if (explicit?.includes('/')) {
    return explicit
  }
  const words = positionalArgs(c.args, GH_LEAK_VALUE_FLAGS, 2)
  if (words[0] !== 'api') {
    return undefined
  }
  // `gh api` addresses the repo through its endpoint path, which sits among the
  // positionals rather than behind `--repo`.
  const endpoints = positionalArgs(c.args, GH_LEAK_VALUE_FLAGS)
  for (let i = 0, { length } = endpoints; i < length; i += 1) {
    const target = repoFromApiEndpoint(endpoints[i]!)
    if (target) {
      return target
    }
  }
  return undefined
}

function pushApiFieldProse(
  c: Command,
  sources: ProseSource[],
  readFile: ProseFileReader,
): void {
  for (const flag of API_FIELD_FLAGS) {
    const values = flagValuesFor(c.args, flag)
    for (let i = 0, { length } = values; i < length; i += 1) {
      const value = values[i]!
      const eq = value.indexOf('=')
      const key = eq > 0 ? value.slice(0, eq) : value
      const raw = eq > 0 ? value.slice(eq + 1) : ''
      if (raw.startsWith('@')) {
        const text = readFile(raw.slice(1))
        if (text) {
          sources.push({ label: `${flag} ${key}=@${raw.slice(1)}`, text })
        }
        continue
      }
      if (raw) {
        sources.push({ label: `${flag} ${key}=`, text: raw })
      }
    }
  }
  for (const flag of API_FILE_FLAGS) {
    const values = flagValuesFor(c.args, flag)
    for (let i = 0, { length } = values; i < length; i += 1) {
      const text = readFile(values[i]!)
      if (text) {
        sources.push({ label: `${flag} ${values[i]!}`, text })
      }
    }
  }
}

/**
 * Every publishable string a `gh` segment carries. Empty when the segment
 * publishes no prose (a read-only `gh pr view`, a bodyless `gh pr merge`).
 */
export function collectOutboundProse(
  c: Command,
  readFile: ProseFileReader,
): ProseSource[] {
  const sources: ProseSource[] = []
  const words = ghSubcommandWords(c)
  if (words[0] === 'api') {
    pushApiFieldProse(c, sources, readFile)
    return sources
  }
  for (const flag of TEXT_FLAGS) {
    const values = flagValuesFor(c.args, flag)
    for (let i = 0, { length } = values; i < length; i += 1) {
      sources.push({ label: flag, text: values[i]! })
    }
  }
  for (const flag of FILE_FLAGS) {
    const values = flagValuesFor(c.args, flag)
    for (let i = 0, { length } = values; i < length; i += 1) {
      const text = readFile(values[i]!)
      if (text) {
        sources.push({ label: `${flag} ${values[i]!}`, text })
      }
    }
  }
  return sources
}
