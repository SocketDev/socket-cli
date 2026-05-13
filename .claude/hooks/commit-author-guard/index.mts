#!/usr/bin/env node
// Claude Code PreToolUse hook — commit-author-guard.
//
// Blocks `git commit` invocations that would author the commit as
// someone other than the user's canonical GitHub identity. Catches:
//
//   1. Wrong --author override:
//        git commit --author="Wrong <wrong@example.com>" -m "..."
//
//   2. Wrong -c user.email override:
//        git commit -c user.email=wrong@example.com -m "..."
//
//   3. Local checkout user.email differs from canonical (e.g. an
//      assistant edited .git/config to point at a Socket work email
//      instead of the personal GitHub email). The commit itself
//      doesn't override but the checkout config is wrong.
//
// Canonical identity sources, in order:
//   (a) ~/.claude/git-authors.json — explicit allowlist, the source
//       of truth when present. Shape:
//         {
//           "canonical": {
//             "name": "jdalton",
//             "email": "john.david.dalton@gmail.com"
//           },
//           "aliases": [
//             { "name": "jdalton", "email": "jdalton@socket.dev" }
//           ]
//         }
//       Canonical is the default; aliases are also allowed (for cases
//       where work email is intentional, e.g. socket-internal repos).
//
//   (b) `git config --global user.email` + `--global user.name` — the
//       user's real identity, fallback when the config file is absent.
//
// Bypass: type "Allow commit-author bypass" in a recent user message,
// or set SOCKET_COMMIT_AUTHOR_GUARD_DISABLED=1.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown } | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

interface GitAuthor {
  readonly name?: string | undefined
  readonly email?: string | undefined
}

interface AllowedAuthors {
  readonly canonical: GitAuthor
  readonly aliases: readonly GitAuthor[]
}

const ENV_DISABLE = 'SOCKET_COMMIT_AUTHOR_GUARD_DISABLED'
const BYPASS_PHRASES = [
  'Allow commit-author bypass',
  'Allow commit author bypass',
  'Allow commitauthor bypass',
] as const

function readAllowedAuthors(): AllowedAuthors {
  // Source (a): ~/.claude/git-authors.json
  const configPath = path.join(homedir(), '.claude', 'git-authors.json')
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
        canonical?: GitAuthor
        aliases?: GitAuthor[]
      }
      const canonical = raw.canonical ?? {}
      const aliases = Array.isArray(raw.aliases) ? raw.aliases : []
      return { canonical, aliases }
    } catch {
      // Fall through to git-config fallback.
    }
  }
  // Source (b): global git config
  let email: string | undefined
  let name: string | undefined
  try {
    email = execSync('git config --global user.email', { encoding: 'utf8' }).trim()
  } catch {
    // unset
  }
  try {
    name = execSync('git config --global user.name', { encoding: 'utf8' }).trim()
  } catch {
    // unset
  }
  return { canonical: { name, email }, aliases: [] }
}

function isAllowedAuthor(
  candidate: GitAuthor,
  allowed: AllowedAuthors,
): boolean {
  const candidateEmail = candidate.email?.toLowerCase()
  if (!candidateEmail) {
    // No email in candidate; can't compare. Treat as ok — git will
    // fail on its own if no identity is configured.
    return true
  }
  if (allowed.canonical.email?.toLowerCase() === candidateEmail) {
    return true
  }
  for (let i = 0, { length } = allowed.aliases; i < length; i += 1) {
    if (allowed.aliases[i]!.email?.toLowerCase() === candidateEmail) {
      return true
    }
  }
  return false
}

// Parse a `git commit ...` command for explicit author overrides.
// Three forms we recognize:
//
//   --author="Name <email@example>"
//   --author "Name <email@example>"
//   -c user.email=email@example -c user.name=Name
//
// Returns the override author if any, otherwise undefined.
function parseAuthorOverride(command: string): GitAuthor | undefined {
  // --author="Name <email>"  or  --author='Name <email>'
  const authorEq = /--author=(['"]?)([^'"<>]+)\s*<([^>]+)>\1/i.exec(command)
  if (authorEq) {
    return { name: authorEq[2]!.trim(), email: authorEq[3]!.trim() }
  }
  // --author "Name <email>"
  const authorSpace = /--author\s+(['"])([^'"<>]+)\s*<([^>]+)>\1/i.exec(command)
  if (authorSpace) {
    return { name: authorSpace[2]!.trim(), email: authorSpace[3]!.trim() }
  }
  // -c user.email=...
  const cEmail = /-c\s+user\.email=([^\s'"]+)/i.exec(command)
  const cName = /-c\s+user\.name=(?:(['"])([^'"]+)\1|([^\s]+))/i.exec(command)
  if (cEmail || cName) {
    return {
      email: cEmail?.[1],
      name: cName ? (cName[2] ?? cName[3]) : undefined,
    }
  }
  return undefined
}

// Read the local checkout's user.email + user.name. Falls through to
// undefined on failure. Used when the command has no explicit override
// — we need to know what git would use by default.
function readCheckoutAuthor(cwd: string | undefined): GitAuthor {
  let email: string | undefined
  let name: string | undefined
  const opts = cwd ? { encoding: 'utf8' as const, cwd } : { encoding: 'utf8' as const }
  try {
    email = execSync('git config user.email', opts).trim()
  } catch {
    // unset
  }
  try {
    name = execSync('git config user.name', opts).trim()
  } catch {
    // unset
  }
  return { name, email }
}

// Detect whether the command is `git commit ...` (not push, not log).
// Also returns true for `git -c ... commit ...` and other forms with
// flags before the subcommand.
function isGitCommit(command: string): boolean {
  // Match `git` (optionally with -c flags between) followed by `commit`.
  // Negative lookahead avoids `git config commit.gpgsign`.
  return /\bgit\b(?:\s+-c\s+[^\s]+)*\s+commit(?:\s|$)/.test(command)
}

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
  const payloadRaw = await readStdin()
  let payload: PreToolUsePayload
  try {
    payload = JSON.parse(payloadRaw) as PreToolUsePayload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.['command']
  if (typeof command !== 'string') {
    process.exit(0)
  }
  if (!isGitCommit(command)) {
    process.exit(0)
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    process.exit(0)
  }

  const allowed = readAllowedAuthors()
  // If we don't have a canonical email configured anywhere, fail open —
  // the hook can't enforce something it doesn't know.
  if (!allowed.canonical.email) {
    process.exit(0)
  }

  // Determine the effective author for this commit.
  const override = parseAuthorOverride(command)
  const effective = override ?? readCheckoutAuthor(payload.cwd)

  if (isAllowedAuthor(effective, allowed)) {
    process.exit(0)
  }

  const lines = [
    '[commit-author-guard] Commit author does not match canonical identity.',
    '',
    `  Effective author : ${effective.name ?? '(unset)'} <${effective.email ?? '(unset)'}>`,
    `  Canonical author : ${allowed.canonical.name ?? '(unset)'} <${allowed.canonical.email}>`,
  ]
  if (allowed.aliases.length > 0) {
    lines.push('  Allowed aliases  :')
    for (let i = 0, { length } = allowed.aliases; i < length; i += 1) {
      const a = allowed.aliases[i]!
      lines.push(`    - ${a.name ?? '(any)'} <${a.email ?? '(any)'}>`)
    }
  }
  lines.push('')
  lines.push('  Fix one of these before committing:')
  lines.push('')
  lines.push('    # Use the canonical identity for this commit:')
  lines.push(`    git -c user.email=${allowed.canonical.email} commit ...`)
  lines.push('')
  lines.push('    # Or correct the local checkout config:')
  lines.push(`    git config user.email ${allowed.canonical.email}`)
  lines.push(`    git config user.name "${allowed.canonical.name ?? 'jdalton'}"`)
  lines.push('')
  lines.push('  Allowed-author list: ~/.claude/git-authors.json')
  lines.push('  (falls back to `git config --global user.email` when absent)')
  lines.push('')
  lines.push('  Bypass: type "Allow commit-author bypass" in a recent message.')
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(2)
}

main().catch(() => {
  process.exit(0)
})
