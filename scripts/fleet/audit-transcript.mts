#!/usr/bin/env node
/**
 * @file Read-only forensic scan of a Claude Code transcript. Flags tool-use
 *   patterns that touched security-sensitive surfaces — gh auth flows, keychain
 *   reads, signing-key reads, dscl authenticate calls, sudo with non-trivial
 *   commands, security-tool installs. Never blocks anything; the point is
 *   post-hoc visibility into what an agent session actually did with privileged
 *   tooling. Usage: node scripts/fleet/audit-transcript.mts <transcript-path>
 *   node scripts/fleet/audit-transcript.mts --json <transcript-path> node
 *   scripts/fleet/audit-transcript.mts --recent # auto-pick most recent Output:
 *   human-readable report grouped by category. With --json, emits {findings:
 *   [...]} for programmatic consumption. The transcript JSONL lives at
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl.
 *   --recent auto-picks the most-recently-modified transcript for the cwd the
 *   script is invoked from.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseShell } from '@socketsecurity/lib-stable/shell/parse'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface Finding {
  // Severity tier. critical = direct credential exfil risk; warn =
  // unusual but explainable; info = forensic record only.
  severity: 'critical' | 'warn' | 'info'
  // Short category label.
  category: string
  // Verbatim or summarized command/input that triggered the finding.
  evidence: string
  // 1-based index in the JSONL of the line that produced this.
  line: number
}

export interface ToolUseEvent {
  name: string
  input: Record<string, unknown>
  line: number
}

export function readToolUses(transcriptPath: string): ToolUseEvent[] {
  if (!existsSync(transcriptPath)) {
    throw new Error(`transcript not found: ${transcriptPath}`)
  }
  const raw = readFileSync(transcriptPath, 'utf8')
  const lines = raw.split('\n').filter(Boolean)
  const out: ToolUseEvent[] = []
  for (let i = 0; i < lines.length; i += 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    // Tool uses appear under message.content[] for assistant turns.
    const msg = (
      evt as { message?: { content?: unknown | undefined } | undefined }
    ).message
    const content = msg?.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const b = block as Record<string, unknown>
      if (b['type'] !== 'tool_use') {
        continue
      }
      const name = typeof b['name'] === 'string' ? b['name'] : undefined
      const input = b['input']
      if (!name || !input || typeof input !== 'object') {
        continue
      }
      out.push({
        name,
        input: input as Record<string, unknown>,
        line: i + 1,
      })
    }
  }
  return out
}

/**
 * Walk a shell command's parsed tokens and return the args of each invocation
 * whose leading tokens match `cmdLine` (e.g. `['sudo']`, `['gh', 'auth',
 * 'refresh']`). Returns an empty array when no invocation matches.
 *
 * Will be lifted to `@socketsecurity/lib-stable/shell/parse` in the next lib
 * bump (the exports are already on socket-lib's `src/` but haven't shipped
 * yet). Keep this inline copy until the cascade can pin the new lib version;
 * remove it then.
 *
 * Uses the AST-based `parseShell` (wraps `shell-quote`) so the matcher sees
 * actual invocations only, not embedded args (`echo "sudo foo"`), variable
 * substitutions (`$gh`), or command substitution (`$(...)`). Treats `&&`, `;`,
 * `||`, `|` as segment terminators so chained commands each get their own
 * scan.
 */
export function findInvocations(
  command: string,
  cmdLine: readonly string[],
): readonly string[][] {
  // shell-quote is permissive — partial parses don't throw; the walk
  // below tolerates any shape it returns.
  const entries = parseShell(command)
  const segments: string[][] = [[]]
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    if (entry && typeof entry === 'object' && 'op' in entry) {
      segments.push([])
      continue
    }
    if (typeof entry === 'string') {
      segments[segments.length - 1]!.push(entry)
    }
  }
  const matches: string[][] = []
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const seg = segments[i]!
    if (seg.length < cmdLine.length) {
      continue
    }
    let ok = true
    for (let j = 0, { length: cl } = cmdLine; j < cl; j += 1) {
      if (seg[j] !== cmdLine[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      matches.push(seg.slice(cmdLine.length))
    }
  }
  return matches
}

/**
 * Convenience: does `command` contain at least one invocation of `cmdLine`?
 * Equivalent to `findInvocations(command, cmdLine).length > 0`. The most common
 * audit-pattern shape.
 */
export function commandInvokes(
  command: string,
  cmdLine: readonly string[],
): boolean {
  return findInvocations(command, cmdLine).length > 0
}

const PATTERNS: ReadonlyArray<{
  severity: Finding['severity']
  category: string
  // Predicate: does this Bash command match this pattern?
  matches: (command: string) => boolean
  // Optional input shape filter (tool_name).
  tool?: string | undefined
}> = [
  // CRITICAL — direct credential exposure paths.
  {
    severity: 'critical',
    category: 'gh auth login (re-auth — verify expected)',
    tool: 'Bash',
    matches: c => /\bgh\s+auth\s+(?:login|logout)\b/.test(c),
  },
  {
    severity: 'critical',
    category: 'gh auth refresh -s workflow (workflow scope grant)',
    tool: 'Bash',
    matches: c => {
      // For each `gh auth refresh ...` invocation, check whether its
      // args carry a `-s|--scopes ...workflow...` pair. The AST walk
      // ensures we only inspect args of the actual gh invocation —
      // `echo "gh auth refresh -s workflow"` doesn't trip the matcher.
      const invocations = findInvocations(c, ['gh', 'auth', 'refresh'])
      for (let i = 0, { length } = invocations; i < length; i += 1) {
        const args = invocations[i]!
        for (let j = 0, { length: al } = args; j < al; j += 1) {
          const a = args[j]
          if (a !== '--scopes' && a !== '-s') {
            continue
          }
          const value = args[j + 1] ?? ''
          if (value.includes('workflow')) {
            return true
          }
        }
      }
      return false
    },
  },
  {
    severity: 'critical',
    category: 'gh workflow dispatch (release/publish surface)',
    tool: 'Bash',
    matches: c =>
      /\bgh\s+workflow\s+(?:dispatch|run)\b/.test(c) ||
      (/\bgh\s+api\b/.test(c) &&
        /\/actions\/workflows\/[^/\s]+\/dispatches\b/.test(c)),
  },
  {
    severity: 'critical',
    category: 'keychain READ via platform CLI',
    tool: 'Bash',
    matches: c =>
      /\bsecurity\s+find-(?:generic|internet)-password\b/.test(c) ||
      /\bsecret-tool\s+lookup\b/.test(c) ||
      /\bkeyring\s+get\b/.test(c) ||
      /\bGet-StoredCredential\b/.test(c),
  },
  {
    severity: 'critical',
    category: 'dscl authentication probe',
    tool: 'Bash',
    matches: c => /\bdscl\b[^|;&]*-authonly\b/.test(c),
  },
  {
    severity: 'critical',
    category: 'sudo invocation (non-cached)',
    tool: 'Bash',
    matches: c =>
      commandInvokes(c, ['sudo']) && !commandInvokes(c, ['sudo', '-k']),
  },
  // WARN — unusual surfaces that should be checked.
  {
    severity: 'warn',
    category: 'gh auth status (token introspection)',
    tool: 'Bash',
    matches: c => /\bgh\s+auth\s+status\b/.test(c),
  },
  {
    severity: 'warn',
    category: 'security add-/delete-generic-password (keychain write)',
    tool: 'Bash',
    matches: c =>
      // macOS `security add|delete-(generic|internet)-password` — keychain
      // write/delete ops.
      /\bsecurity\s+(?:add|delete)-(?:generic|internet)-password\b/.test(c) ||
      // Linux libsecret equivalents: `secret-tool store` / `secret-tool clear`.
      /\bsecret-tool\s+(?:clear|store)\b/.test(c),
  },
  {
    severity: 'warn',
    category: 'private-key file access (~/.ssh, .pem)',
    tool: 'Bash',
    matches: c =>
      /~\/\.ssh\/[^\s|;&]+/.test(c) ||
      /\bopenssl\s+(?:pkcs8|pkey|rsa)\b/.test(c) ||
      /\bssh-keygen\b/.test(c) ||
      /\.pem\b/.test(c),
  },
  // INFO — forensic record.
  {
    severity: 'info',
    category: 'git push (artifact emission)',
    tool: 'Bash',
    matches: c => /\bgit\s+push\b/.test(c),
  },
  {
    severity: 'info',
    category: 'workflow YAML edit',
    matches: c => /\.github\/workflows\/[^/\s]+\.ya?ml/.test(c),
  },
]

export function scanToolUse(evt: ToolUseEvent): Finding[] {
  const findings: Finding[] = []
  // Most patterns target Bash commands; some target file paths (Edit/Write).
  const command =
    evt.name === 'Bash'
      ? String((evt.input as { command?: unknown | undefined }).command ?? '')
      : ''
  const filePath =
    evt.name === 'Edit' || evt.name === 'Write'
      ? String(
          (evt.input as { file_path?: unknown | undefined }).file_path ?? '',
        )
      : ''
  const haystack = command || filePath
  if (!haystack) {
    return findings
  }
  for (let i = 0, { length } = PATTERNS; i < length; i += 1) {
    const p = PATTERNS[i]!
    if (p.tool && p.tool !== evt.name) {
      continue
    }
    if (!p.matches(haystack)) {
      continue
    }
    findings.push({
      severity: p.severity,
      category: p.category,
      evidence:
        haystack.length > 200 ? haystack.slice(0, 197) + '...' : haystack,
      line: evt.line,
    })
  }
  return findings
}

export function claudeProjectSlug(cwd: string): string {
  // Claude's project directory is a flattened absolute path. Replace both
  // platform separators and the Windows drive separator so the slug is one
  // legal path segment everywhere (`C:\\repo` -> `C--repo`).
  return cwd.replace(/[\\/:]/g, '-')
}

export function findRecentTranscript(
  home: string = os.homedir(),
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- audit-transcript intentionally reads the user-invoked cwd to look up the matching Claude Code transcript dir; anchoring on the script's own location would always return the wheelhouse transcripts.
  cwd: string = process.cwd(),
): string | undefined {
  // ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
  // encoded-cwd flattens path separators (and a Windows drive separator) to
  // `-`. The leading `/` becomes the leading `-` automatically. For example,
  // `/Users/foo` -> `-Users-foo`; `C:\\Users\\foo` -> `C--Users-foo`.
  const encoded = claudeProjectSlug(cwd)
  const dir = path.join(home, '.claude', 'projects', encoded)
  if (!existsSync(dir)) {
    return undefined
  }
  // TOCTOU: another Claude Code session may rotate/delete a .jsonl between
  // readdir and stat. Tolerate missing entries instead of crashing.
  const entries = readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const full = path.join(dir, f)
      try {
        return { full, mtime: statSync(full).mtimeMs }
      } catch {
        return undefined
      }
    })
    .filter((x): x is { full: string; mtime: number } => x !== undefined)
    // oxlint-disable-next-line unicorn/no-array-sort -- .filter() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
    .sort((a, b) => b.mtime - a.mtime)
  return entries[0]?.full
}

export interface Args {
  json: boolean
  transcript: string | undefined
  recent: boolean
}

export function parseArgs(argv: readonly string[]): Args {
  let json = false
  let recent = false
  let transcript: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--json') {
      json = true
    } else if (a === '--recent') {
      recent = true
    } else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    } else if (a && !a.startsWith('--')) {
      transcript = a
    }
  }
  return { json, recent, transcript }
}

function printHelp(): void {
  logger.log(
    'audit-transcript — read-only forensic scan of a Claude Code transcript',
  )
  logger.log('')
  logger.log('Usage:')
  logger.log('  node scripts/fleet/audit-transcript.mts <transcript-path>')
  logger.log(
    '  node scripts/fleet/audit-transcript.mts --recent           # auto-pick most recent',
  )
  logger.log(
    '  node scripts/fleet/audit-transcript.mts --json <path>      # JSON output for tooling',
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  let target = args.transcript
  if (!target && args.recent) {
    target = findRecentTranscript()
    if (!target) {
      logger.error('No transcript found for this cwd.')
      process.exit(1)
    }
  }
  if (!target) {
    printHelp()
    process.exit(1)
  }

  const toolUses = readToolUses(target)
  const findings: Finding[] = []
  for (const evt of toolUses) {
    findings.push(...scanToolUse(evt))
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ transcript: target, findings }, null, 2),
    )
    process.stdout.write('\n')
    return
  }

  logger.log(`Transcript: ${target}`)
  logger.log(`Tool uses scanned: ${toolUses.length}`)
  logger.log(`Findings: ${findings.length}`)
  logger.log('')

  if (findings.length === 0) {
    logger.success('No security-relevant tool-use patterns detected.')
    return
  }

  const byCategory = new Map<string, Finding[]>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const list = byCategory.get(f.category) ?? []
    list.push(f)
    byCategory.set(f.category, list)
  }

  for (const severity of ['critical', 'warn', 'info'] as const) {
    const entries = [...byCategory.entries()].filter(
      ([, fs]) => fs[0]!.severity === severity,
    )
    if (entries.length === 0) {
      continue
    }
    logger.log(`── ${severity.toUpperCase()} ──`)
    for (const [category, fs] of entries) {
      logger.log(`  ${category} (${fs.length})`)
      const fList = fs.slice(0, 5)
      for (let i = 0, { length } = fList; i < length; i += 1) {
        const f = fList[i]!
        logger.log(`    line ${f.line}: ${f.evidence}`)
      }
      if (fs.length > 5) {
        logger.log(`    ... and ${fs.length - 5} more`)
      }
    }
    logger.log('')
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    logger.error(String((err as Error)?.message ?? err))
    process.exit(1)
  })
}
