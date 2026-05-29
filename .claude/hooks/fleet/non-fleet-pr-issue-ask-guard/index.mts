#!/usr/bin/env node
// Claude Code PreToolUse hook — non-fleet-pr-issue-ask-guard.
//
// Blocks `gh pr create` / `gh issue create` / `gh release create`
// calls that target a repository NOT in the fleet roster. The
// canonical fleet rule: never auto-submit publicly-visible artifacts
// (PRs, issues, releases) to upstream / third-party repos without
// explicit user confirmation. Captured plan text + batched "do all N
// tasks" directives are NOT standing authorization to post under the
// user's gh identity.
//
// 2026-05-28 incident: a captured-plan task said "file an oxfmt
// upstream issue" as one bullet. Working through the deferred list,
// I ran `gh issue create --repo oxc-project/oxc ...` without re-
// confirming. The user said "don't create an issue" but the bg `gh`
// call had already completed; the issue was live until closed
// post-hoc with an "opened in error" comment. This hook prevents
// the repeat.
//
// Detection:
//   - Fires only on Bash commands containing `gh pr create`,
//     `gh issue create`, or `gh release create`.
//   - Resolves the target repo via `--repo <owner>/<name>` flag
//     when present, otherwise via `git remote get-url origin` from
//     the resolved git cwd (same priority order as
//     `no-non-fleet-push-guard`: -C <dir>, then `cd <dir> &&`,
//     then process.cwd()).
//   - Blocks when the slug is not in FLEET_REPO_NAMES.
//
// Bypass: `Allow non-fleet-publish bypass` typed verbatim in a
// recent user turn.
//
// Fails OPEN on resolution ambiguity (can't find the command, the
// dir, or the remote): better to under-block than to wedge a
// legitimate fleet PR/issue when the shape is unfamiliar.

import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { isFleetRepo, slugFromRemoteUrl } from '../_shared/fleet-repos.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow non-fleet-publish bypass'

const GH_DASH_REPO_RE = /--repo[\s=]+("([^"]+)"|'([^']+)'|(\S+))/
const GIT_DASH_C_RE = /\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/
const LEADING_CD_RE = /(?:^|[;&|]|&&)\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))/

// gh subcommands that publish public-facing content. `release create`
// is also in the harness deny list, but the hook layer here catches
// the bypass-phrase escape path so the user has ONE consistent way
// to authorize public-facing actions.
const PUBLIC_SURFACE_SUBCOMMANDS = [
  ['pr', 'create'],
  ['issue', 'create'],
  ['release', 'create'],
] as const

export function extractGhTargetRepo(command: string): string | undefined {
  const m = GH_DASH_REPO_RE.exec(command)
  if (m) {
    return m[2] ?? m[3] ?? m[4]
  }
  return undefined
}

export function extractGitCwd(command: string): string {
  const dashC = GIT_DASH_C_RE.exec(command)
  if (dashC) {
    return dashC[2] ?? dashC[3] ?? dashC[4] ?? process.cwd()
  }
  const cd = LEADING_CD_RE.exec(command)
  if (cd) {
    const dir = cd[2] ?? cd[3] ?? cd[4]
    if (dir) {
      return path.resolve(process.cwd(), dir)
    }
  }
  return process.cwd()
}

function originSlugFromCwd(dir: string): string | undefined {
  try {
    const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5000,
    })
    if (r.status !== 0) {
      return undefined
    }
    const url = (r.stdout ?? '').trim()
    return slugFromRemoteUrl(url)
  } catch {
    return undefined
  }
}

// Identifies the gh subcommand. Returns the matching
// [verb, action] pair when one is present at an executable
// position, undefined otherwise.
export function findPublicGhInvocation(
  command: string,
): readonly [string, string] | undefined {
  const ghCommands = commandsFor(command, 'gh')
  for (const c of ghCommands) {
    for (const pair of PUBLIC_SURFACE_SUBCOMMANDS) {
      if (c.args[0] === pair[0] && c.args[1] === pair[1]) {
        return pair
      }
    }
  }
  return undefined
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: ToolInput
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.command ?? ''
  if (!command || !/\bgh\b/.test(command)) {
    process.exit(0)
  }
  const subcommand = findPublicGhInvocation(command)
  if (!subcommand) {
    process.exit(0)
  }

  // Resolve target slug. `--repo` carries owner/repo (shown
  // verbatim in messages). For membership, `isFleetRepo` keys on
  // the bare repo name, so strip the owner before checking.
  let slug: string | undefined
  const dashRepo = extractGhTargetRepo(command)
  if (dashRepo) {
    slug = dashRepo
  } else {
    const cwd = extractGitCwd(command)
    slug = originSlugFromCwd(cwd)
  }
  if (!slug) {
    // Fail open — can't determine target. The user gets the gh
    // command's own error if it's malformed.
    process.exit(0)
  }
  const slashIdx = slug.indexOf('/')
  const bareSlug = slashIdx === -1 ? slug : slug.slice(slashIdx + 1)

  if (isFleetRepo(bareSlug)) {
    // Fleet repo — fall through. The action is authorized by being
    // inside the fleet.
    process.exit(0)
  }

  // Non-fleet target. Check bypass phrase.
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  process.stderr.write(
    [
      'non-fleet-pr-issue-ask-guard: blocked',
      '',
      `  Command targets non-fleet repo: ${slug}`,
      `  Subcommand: gh ${subcommand.join(' ')}`,
      '',
      `  Public-facing artifacts (PRs, issues, releases) on non-fleet`,
      `  repos go out under your gh identity. The fleet rule: never`,
      `  submit without explicit per-action user confirmation —`,
      `  captured plans + "do all N tasks" directives do NOT count.`,
      '',
      `  If you really want to submit: type the canonical phrase`,
      `  in your next message, then re-run:`,
      `    ${BYPASS_PHRASE}`,
      '',
      '  Otherwise: draft locally, share for review, get explicit',
      '  yes/no before re-attempting.',
    ].join('\n') + '\n',
  )
  process.exit(2)
}

main().catch(err => {
  process.stderr.write(
    `non-fleet-pr-issue-ask-guard: hook crashed, failing open: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(0)
})
