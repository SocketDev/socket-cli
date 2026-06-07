#!/usr/bin/env node
// Claude Code PreToolUse hook — verify-render-pre-commit-reminder.
//
// Reminder on `git commit` when:
//   1. The staged file set contains UI/render-shape files
//      (`*.html`, `*.css`, `scripts/tour.mts`-shape build inputs), AND
//   2. The transcript shows a recent build invocation that affected
//      those files (e.g. `pnpm run build`, `node scripts/tour.mts`,
//      `pnpm tour`, etc.), AND
//   3. There's no explicit "looks good" / "ship it" / "push" /
//      "verified" / "confirmed" / "rebuild looks correct" from the user
//      since that build ran.
//
// Surfaces a stderr reminder asking the agent to verify the rebuilt
// output BEFORE committing. Past pattern: multiple wasted commits per
// session ("rebuild before you fucking commit"). Reporting-only — never
// blocks; the verification step is the agent's call.
//
// No-op when the staged set is purely non-UI source.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

// Files whose changes likely affect rendered output.
const UI_FILE_RE =
  /\.(?:astro|css|ejs|handlebars|hbs|htm|html|less|njk|sass|scss|svelte|vue)$/i

// Build-script patterns. Conservative — match the common fleet shapes:
// `pnpm run build`, `pnpm build`, `node scripts/<name>.mts`, `pnpm tour`,
// `pnpm site`, `pnpm docs:build`.
const BUILD_COMMAND_RES = [
  /\bpnpm\s+(?:run\s+)?(?:build|docs:build|docs:dev|render|site|tour)\b/,
  /\bnode\s+(?:[^&;|]*\/)?scripts\/(?:build|emit-html|generate-site|render|tour)/,
]

// User signals that mean "the build is verified, go ahead and commit."
const VERIFY_PATTERNS = [
  /\blooks good\b/i,
  /\bship it\b/i,
  /\bverified\b/i,
  /\bconfirmed\b/i,
  /\brebuild looks (?:correct|good|right)\b/i,
  /\bbuild is (?:correct|good)\b/i,
  /\brender(?:ed)? (?:looks )?(?:correct|good|right)\b/i,
  /\bpush(?:\s|$|\.)/i,
]

interface Analysis {
  buildCommand: string | undefined
  buildIndex: number
  verifyIndex: number
}

export function analyzeTranscript(entries: TranscriptEntry[]): Analysis {
  let buildCommand: string | undefined
  let buildIndex = -1
  let verifyIndex = -1
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!
    const msg = e.message
    if (!msg) {
      continue
    }
    const content = msg.content
    // Build invocation — find in assistant tool_use Bash calls.
    if (Array.isArray(content)) {
      for (let i = 0, { length } = content; i < length; i += 1) {
        const part = content[i]!
        if (part === null || typeof part !== 'object') {
          continue
        }
        const name = (part as { name?: unknown | undefined }).name
        const input = (part as { input?: unknown | undefined }).input
        if (
          name === 'Bash' &&
          input &&
          typeof input === 'object' &&
          typeof (input as { command?: unknown | undefined }).command ===
            'string'
        ) {
          const cmd = (input as { command: string }).command
          for (let j = 0, { length } = BUILD_COMMAND_RES; j < length; j += 1) {
            const re = BUILD_COMMAND_RES[j]!
            if (re.test(cmd)) {
              buildCommand = cmd
              buildIndex = i
              break
            }
          }
        }
      }
    }
    // User verify signal — string content of user turn.
    if (e.type === 'user') {
      let text = ''
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content)) {
        text = content
          .map(seg =>
            typeof seg === 'string'
              ? seg
              : typeof (seg as { text?: unknown | undefined }).text === 'string'
                ? (seg as { text: string }).text
                : '',
          )
          .join('\n')
      }
      for (let j = 0, { length } = VERIFY_PATTERNS; j < length; j += 1) {
        const re = VERIFY_PATTERNS[j]!
        if (re.test(text)) {
          verifyIndex = i
          break
        }
      }
    }
  }
  return { buildCommand, buildIndex, verifyIndex }
}

export function isGitCommit(command: string): boolean {
  return /\bgit\s+commit\b/.test(command)
}

interface TranscriptEntry {
  type?: string | undefined
  message?:
    | {
        content?: unknown | undefined
      }
    | undefined
  toolUseResult?: unknown | undefined
}

export function readTranscript(transcriptPath: string): TranscriptEntry[] {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const out: TranscriptEntry[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }
    try {
      out.push(JSON.parse(line) as TranscriptEntry)
    } catch {
      // skip
    }
  }
  return out
}

export function stagedFiles(cwd: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
}

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return
  }

  const cwd = payload.cwd ?? process.cwd()
  const staged = stagedFiles(cwd)
  const uiStaged = staged.filter(f => UI_FILE_RE.test(f))
  if (uiStaged.length === 0) {
    return
  }

  if (!payload.transcript_path) {
    return
  }
  const entries = readTranscript(payload.transcript_path)
  const { buildCommand, buildIndex, verifyIndex } = analyzeTranscript(entries)
  if (buildIndex < 0) {
    // No build ran; can't reason about freshness.
    return
  }
  if (verifyIndex > buildIndex) {
    // User explicitly verified after the build.
    return
  }

  const lines: string[] = []
  lines.push(
    '[verify-render-pre-commit-reminder] About to commit UI/render files',
  )
  lines.push('')
  lines.push('  UI files staged:')
  for (const f of uiStaged.slice(0, 5)) {
    lines.push(`    ${f}`)
  }
  if (uiStaged.length > 5) {
    lines.push(`    (+${uiStaged.length - 5} more)`)
  }
  lines.push('')
  if (buildCommand) {
    lines.push(`  Recent build: ${buildCommand.slice(0, 80)}`)
  }
  lines.push('  No user verification signal since the build ran.')
  lines.push('')
  lines.push(
    '  Past pattern: committing UI changes before verifying the rebuilt',
  )
  lines.push(
    '  output produces wasted commits. Open the rendered artifact, confirm',
  )
  lines.push('  it looks correct, then commit.')
  lines.push('')
  lines.push('  Reminder-only; not a block.')
  lines.push('')
  logger.error(lines.join('\n'))
  return
})
