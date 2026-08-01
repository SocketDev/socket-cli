#!/usr/bin/env node
// Claude Code PreToolUse hook — no-version-bump-pr-guard.
//
// HARD-BLOCKS any command that opens a pull request to land a VERSION BUMP. A
// bump commit goes DIRECTLY on the default branch — that is what the local
// release pipeline's bump stage does, and what the CI bump does through the
// release App. A PR for the bump is a defect: it parks the release behind
// branch-protection requirements a freshly-created branch cannot satisfy
// (`enablePullRequestAutoMerge` fails with "Pull request Branch does not have
// required protected branch rules"), the run dies, and the publish never
// happens. There is nothing for a reviewer to approve either — the version came
// from the committed hint and the diff is machine-generated.
//
// Two families of PR-opening command are covered:
//
//   • `gh pr create` / `gh pr new` — the head branch (`--head` / `-H` /
//     `--head=`, else the current checkout's branch) and the title (`--title` /
//     `-t` / `--title=`). A `--body-file` / `-F` payload is read and scanned for
//     a bump SUBJECT line, so a body-file-driven PR cannot slip past.
//   • The GitHub API — `gh api …/repos/<o>/<r>/pulls` with `-f head=…` /
//     `-f title=…` fields, and a raw REST `POST /repos/<o>/<r>/pulls` from curl
//     (or anything else) with a JSON body naming `head` / `title`.
//
// Detection rides the shell-quote-backed shell-command.mts AST parser, never a
// raw regex over the command string, so `&&` chains, quoting, and `$(…)`
// substitution are handled and a literal "gh pr create" inside a grep string
// can't false-fire.
//
// Universal safety: NOT gated on fleet membership. A bump PR against an
// external repo strands that repo's release the same way.
//
// Bypass: `Allow version-bump-pr bypass` in a recent user turn.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { ghPrCreateCommands } from '../_shared/gh-pr-command.mts'
import { currentBranch } from '../_shared/git-branch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { flagValue, parseCommands } from '../_shared/shell-command.mts'

import type { GuardResult } from '../_shared/guard.mts'

// Dispatcher pre-flight: `gh pr create` carries the literal `pr` token, and
// every REST pull-request write carries `pulls` in its endpoint path. A payload
// with neither can't match, so the dispatcher skips importing this guard.
export const triggers: readonly string[] = ['pr', 'pulls']

// A semver core (`1.2.3`) with an optional `-prerelease` / `+build` tail — the
// version token every bump-shaped branch name and title carries.
const SEMVER_SOURCE = String.raw`\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?`

// Branch names a version bump gets parked on. Anchored, so only a whole branch
// name matches:
//   1. `<channel>-publish-v1.2.3` — the release pipeline's throwaway branch
//      (`npm-publish-v…`, `cargo-publish-v…`); the channel prefix is optional.
//   2. `release-v1.2.3` — the hand-rolled release branch.
//   3. `bump-1.2.3` / `bump-v1.2.3`.
// The last entry is a deliberate SUBSTRING match: any branch carrying the
// `version-bump` token (`chore/foo-version-bump`, `version-bump-6.5.2`).
const BUMP_BRANCH_PATTERNS: readonly RegExp[] = [
  new RegExp(`^(?:[a-z][a-z0-9-]*-)?publish-v${SEMVER_SOURCE}$`, 'i'),
  new RegExp(`^release-v${SEMVER_SOURCE}$`, 'i'),
  new RegExp(`^bump-v?${SEMVER_SOURCE}$`, 'i'),
  /version-bump/i,
]

// The exact bump SUBJECTS the release tooling writes. `chore: bump version to
// 1.2.3` is the commit subject `bump.mts` commits (an optional `(scope)` is
// tolerated); `chore(release): 1.2.3` is the conventional-commits release
// spelling. Multiline, so the same patterns scan a body file line by line.
const BUMP_SUBJECT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^\\s*chore(?:\\([^)]*\\))?:\\s*bump version to\\s+v?${SEMVER_SOURCE}\\b`,
    'im',
  ),
  new RegExp(`^\\s*chore\\(release\\):\\s*v?${SEMVER_SOURCE}\\b`, 'im'),
]

// The loose phrase that catches every hand-written bump title ("Bump version",
// "bump version for 6.5.2"). Applied to a TITLE only — a body's prose can
// mention bumping a version without the body being a bump PR.
const BUMP_TITLE_PHRASE_RE = /\bbump version\b/i

// `repos/<owner>/<repo>/pulls` — the REST endpoint that CREATES a pull request,
// in every spelling a CLI accepts: bare (`repos/o/r/pulls`), rooted
// (`/repos/o/r/pulls`), or a full API URL. A trailing `/<number>` (reading or
// editing ONE pull request) deliberately does not match.
const PULLS_ENDPOINT_RE = /(?:^|\/)repos\/[^/\s]+\/[^/\s]+\/pulls\/?(?:$|[?#])/i

// `gh api` field flags — the value is a `head=…` / `title=…` kv string.
const API_FIELD_FLAGS: ReadonlySet<string> = new Set([
  '--field',
  '--raw-field',
  '-F',
  '-f',
])

// Request-body flags — the value is a JSON payload (`curl -d '{"head":…}'`,
// `gh api --input <file>`).
const DATA_FLAGS: ReadonlySet<string> = new Set([
  '--data',
  '--data-binary',
  '--data-raw',
  '--json',
  '-d',
])

/**
 * The `head` / `title` a pull-request-creating command names.
 */
export interface PullRequestFields {
  readonly head?: string | undefined
  readonly title?: string | undefined
}

/**
 * One PR-opening intent read off a command, with the surface it came from so
 * the block message can name it.
 */
export interface PullRequestProposal extends PullRequestFields {
  // Multi-line prose (a `--body-file` payload) scanned for a bump subject.
  readonly body?: string | undefined
  // Human-readable origin, e.g. `gh pr create` or `gh api …/pulls`.
  readonly source: string
}

/**
 * Strip the decorations a branch reference can carry: a `<owner>:` fork prefix
 * (`me:feat/x` → `feat/x`) and a `refs/heads/` qualifier.
 */
export function stripBranchDecoration(branch: string): string {
  let name = branch.trim()
  if (name.startsWith('refs/heads/')) {
    name = name.slice('refs/heads/'.length)
  }
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

/**
 * True when a branch name is version-bump shaped.
 */
export function isVersionBumpBranch(branch: string): boolean {
  const name = stripBranchDecoration(branch)
  return name !== '' && BUMP_BRANCH_PATTERNS.some(re => re.test(name))
}

/**
 * True when a PR title is version-bump shaped.
 */
export function isVersionBumpTitle(title: string): boolean {
  const text = title.trim()
  if (text === '') {
    return false
  }
  return (
    BUMP_TITLE_PHRASE_RE.test(text) ||
    BUMP_SUBJECT_PATTERNS.some(re => re.test(text))
  )
}

/**
 * True when multi-line prose carries a bump SUBJECT line. Stricter than the
 * title test on purpose: a body may discuss bumping without being a bump PR.
 */
export function hasVersionBumpSubject(text: string): boolean {
  return text !== '' && BUMP_SUBJECT_PATTERNS.some(re => re.test(text))
}

/**
 * The HTTP method a segment names, upper-cased, in every spelling:
 * `--method POST`, `--method=POST`, `--request POST`, `-X POST`, `-XPOST`.
 */
function httpMethodFlag(args: readonly string[]): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--method' || arg === '--request' || arg === '-X') {
      const next = args[i + 1]
      return next === undefined ? undefined : next.toUpperCase()
    }
    if (arg.startsWith('--method=')) {
      return arg.slice('--method='.length).toUpperCase()
    }
    if (arg.startsWith('--request=')) {
      return arg.slice('--request='.length).toUpperCase()
    }
    if (arg.startsWith('-X') && arg.length > 2) {
      return arg.slice(2).toUpperCase()
    }
  }
  return undefined
}

// Read `"head": "…"` / `"title": "…"` out of a JSON request body. The quoted
// key, then any run of non-quote characters as the value.
const JSON_HEAD_RE = /"head"\s*:\s*"(?<head>[^"]*)"/i
const JSON_TITLE_RE = /"title"\s*:\s*"(?<title>[^"]*)"/i

/**
 * Pull `head` / `title` out of a JSON request body. `JSON.parse` wins when the
 * payload is well-formed; a shell-interpolated payload can arrive with a
 * collapsed `$VAR` token that no longer parses, so a key scan is the fallback.
 */
export function jsonPullRequestFields(payload: string): PullRequestFields {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const head = record['head']
      const title = record['title']
      return {
        head: typeof head === 'string' ? head : undefined,
        title: typeof title === 'string' ? title : undefined,
      }
    }
  } catch {
    // Not well-formed JSON — fall through to the key scan below.
  }
  return {
    head: JSON_HEAD_RE.exec(payload)?.groups?.['head'],
    title: JSON_TITLE_RE.exec(payload)?.groups?.['title'],
  }
}

/**
 * Read the `head` / `title` a `gh api` / `curl` segment sends: `-f head=…`
 * style fields, a `-d '{…}'` JSON body, or a `--input <file>` JSON file.
 */
export function apiPullRequestFields(
  args: readonly string[],
): PullRequestFields {
  let head: string | undefined
  let title: string | undefined
  const absorb = (fields: PullRequestFields): void => {
    head = head ?? fields.head
    title = title ?? fields.title
  }
  const absorbKeyValue = (kv: string): void => {
    if (kv.startsWith('head=')) {
      head = head ?? kv.slice('head='.length)
    } else if (kv.startsWith('title=')) {
      title = title ?? kv.slice('title='.length)
    }
  }
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (API_FIELD_FLAGS.has(arg)) {
      const value = args[i + 1]
      if (value !== undefined) {
        absorbKeyValue(value)
      }
      continue
    }
    if ((arg.startsWith('-f') || arg.startsWith('-F')) && arg.length > 2) {
      absorbKeyValue(arg.slice(2))
      continue
    }
    if (DATA_FLAGS.has(arg)) {
      const value = args[i + 1]
      if (value !== undefined) {
        absorb(jsonPullRequestFields(value))
      }
      continue
    }
    const eq = arg.indexOf('=')
    if (eq > 0 && DATA_FLAGS.has(arg.slice(0, eq))) {
      absorb(jsonPullRequestFields(arg.slice(eq + 1)))
      continue
    }
    if (arg === '--input') {
      const file = args[i + 1]
      const text = file === undefined ? undefined : safeReadFileSync(file)
      if (text) {
        absorb(jsonPullRequestFields(text))
      }
    }
  }
  return { head, title }
}

/**
 * Every `gh pr create` / `gh pr new` intent in the command. `cwd` supplies the
 * fallback head — the checkout's current branch — when no `--head` is given.
 */
export function ghPrCreateProposals(
  command: string,
  cwd?: string | undefined,
): PullRequestProposal[] {
  const proposals: PullRequestProposal[] = []
  for (const cmd of ghPrCreateCommands(command)) {
    const { args } = cmd
    const head = flagValue(args, '--head', '-H')
    const bodyFile = flagValue(args, '--body-file', '-F')
    proposals.push({
      body: bodyFile === undefined ? undefined : safeReadFileSync(bodyFile),
      head: head ?? (cwd === undefined ? undefined : currentBranch(cwd)),
      source: 'gh pr create',
      title: flagValue(args, '--title', '-t'),
    })
  }
  return proposals
}

/**
 * Every pull-request CREATE issued against the GitHub REST API — `gh api` or a
 * raw `curl` — read off the parsed command segments. A segment counts when it
 * names a `/repos/<o>/<r>/pulls` endpoint AND either declares `POST` or carries
 * a `head` / `title` payload (both `gh api` and `curl` switch to POST once a
 * field or data body is attached).
 */
export function githubApiPullProposals(command: string): PullRequestProposal[] {
  const proposals: PullRequestProposal[] = []
  for (const cmd of parseCommands(command)) {
    const { args } = cmd
    if (!args.some(arg => PULLS_ENDPOINT_RE.test(arg))) {
      continue
    }
    const method = httpMethodFlag(args)
    if (method !== undefined && method !== 'POST') {
      continue
    }
    const fields = apiPullRequestFields(args)
    if (method === undefined && !fields.head && !fields.title) {
      continue
    }
    proposals.push({
      head: fields.head,
      source: `${cmd.binary || 'curl'} → POST /repos/…/pulls`,
      title: fields.title,
    })
  }
  return proposals
}

/**
 * Every PR-opening intent in the command, across both surfaces.
 */
export function pullRequestProposals(
  command: string,
  cwd?: string | undefined,
): PullRequestProposal[] {
  return [
    ...ghPrCreateProposals(command, cwd),
    ...githubApiPullProposals(command),
  ]
}

/**
 * The first bump-shaped signal in a proposal — the field name and the offending
 * value — or undefined when the proposal is an ordinary PR.
 */
export function versionBumpSignal(
  proposal: PullRequestProposal,
): { field: string; value: string } | undefined {
  const { body, head, title } = proposal
  if (head !== undefined && isVersionBumpBranch(head)) {
    return { field: 'head branch', value: head }
  }
  if (title !== undefined && isVersionBumpTitle(title)) {
    return { field: 'title', value: title }
  }
  if (body !== undefined && hasVersionBumpSubject(body)) {
    return { field: 'body file', value: body.split('\n')[0]?.trim() ?? '' }
  }
  return undefined
}

/**
 * The four-ingredient block message: What / Where / Saw vs. wanted / Fix.
 */
export function blockMessage(config: {
  cwd: string
  field: string
  source: string
  value: string
}): string {
  const cfg = { __proto__: null, ...config } as {
    cwd: string
    field: string
    source: string
    value: string
  }
  return [
    '[no-version-bump-pr-guard] Refusing to open a pull request for a version bump.',
    '',
    `  What:   ${cfg.source} would open a PR whose ${cfg.field} is version-bump shaped.`,
    `  Where:  ${cfg.cwd}`,
    `  Saw:    ${cfg.field} = ${cfg.value}`,
    '  Wanted: the bump commit landing DIRECTLY on the default branch. A repo',
    '          with a release workflow never routes its bump through a PR — the',
    '          branch has no protected-branch rules yet, so auto-merge fails with',
    '          "Pull request Branch does not have required protected branch rules"',
    '          and the publish dies with the version stranded.',
    '',
    '  Fix:    land the bump commit on the default branch instead —',
    '            local:  node scripts/fleet/publish-pipeline.mts   # its bump',
    '                    stage commits straight to the default branch',
    '            CI:     the release App commits + fast-forwards the default',
    '                    branch (scripts/fleet/publish-infra/release-branch.mts)',
    '          Then drop the bump branch:',
    '            git push origin --delete <branch>',
    '',
  ].join('\n')
}

export const check = bashGuard((command, payload): GuardResult => {
  const cwd = resolveProjectDir(payload.cwd)
  for (const proposal of pullRequestProposals(command, cwd)) {
    const signal = versionBumpSignal(proposal)
    if (signal) {
      return block(
        blockMessage({
          cwd,
          field: signal.field,
          source: proposal.source,
          value: signal.value,
        }),
      )
    }
  }
  return undefined
})

export const hook = defineHook({
  bypass: ['version-bump-pr'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
