#!/usr/bin/env node
// Claude Code PreToolUse hook — no-hook-cmd-regex-guard.
//
// Edit-time enforcement of CLAUDE.md's "prefer AST-based parsing over
// regex when a Bash-allowlist hook reasons about command structure".
// Blocks Write/Edit ops on a `.claude/hooks/**` file that introduce a
// regex literal which parses a SHELL COMMAND — i.e. a regex whose body
// names a shell binary (git, gh, npm, pnpm, yarn, node, docker, …)
// next to a whitespace/boundary metachar (`\s`, `\b`, ` +`). That shape
// is the tell that someone is matching `git push` / `gh pr create` with
// a regex instead of the shell-quote-backed parser in
// `.claude/hooks/fleet/_shared/shell-command.mts` (parseCommands /
// findInvocation / commandsFor). Regex misreads `&&` chains, quoting,
// and `$(…)` substitution and false-positives on a literal in a grep
// arg; the parser handles all of it.
//
// This guard detects a CODE pattern (a regex literal in source text),
// not a shell command — so it is itself allowed to use regex.
//
// Scope: only files under `.claude/hooks/`. Application code elsewhere
// may legitimately regex over command strings for other reasons.
//
// Bypass: `Allow command-regex bypass` in a recent turn (e.g. matching a
// tool's stdout, not a command line).
//
// Exit codes: 0 pass, 2 block. Fails open on malformed payloads.

import {
  block,
  defineHook,
  editGuard,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const BYPASS_PHRASE = 'Allow command-regex bypass'

// Shell binaries whose appearance inside a regex literal signals
// command-structure matching. Kept to the high-signal ones the fleet's
// Bash-allowlist hooks actually reason about.
const SHELL_BINARIES = [
  'git',
  'gh',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'node',
  'docker',
  'cargo',
  'pip',
  'pip3',
  'uv',
  'taskkill',
]

interface Finding {
  readonly line: number
  readonly text: string
  readonly binary: string
}

// A regex literal: `/…/flags`. We scan each line for `/`-delimited
// bodies (skipping obvious division by requiring at least one regex
// metachar inside) and check whether the body names a shell binary
// adjacent to a whitespace/boundary metachar.
const REGEX_LITERAL = /\/((?:\\.|[^/\n\\])+)\/[dgimsuvy]*/g

// Within a regex body, a shell binary token followed (allowing flags) by
// a whitespace/boundary metachar — `\bgit\b`, `git\s+`, `gh\s+pr`,
// `pnpm +run`, etc. The binary is captured for the diagnostic.
function commandShapeBinary(regexBody: string): string | undefined {
  for (let i = 0, { length } = SHELL_BINARIES; i < length; i += 1) {
    const bin = SHELL_BINARIES[i]!
    // The "matching a command line" signature: the binary token bounded
    // by regex separators on BOTH sides. Prefix: string start, a boundary
    // metachar (`\b`, `\s`, `\S`), or a group/alternation char (`^`, `|`,
    // `(`, `)`, space). Suffix: `\b`, `\s`, ` +`, or a space. This matches
    // `\bgit\s+push`, `(?:^|\s)pnpm +run`, `gh\s+pr` while rejecting
    // `gitignore` (suffix is `i`, a word char) and `subgit` (no prefix
    // boundary). Backslashes are doubled for the string→RegExp step.
    const prefix = '(?:^|\\\\[bsS]|[(|)^ ])'
    const suffix = '(?:\\\\[bsS]|\\+| )'
    const shape = new RegExp(`${prefix}${bin}${suffix}`)
    if (shape.test(regexBody)) {
      return bin
    }
  }
  return undefined
}

export function findCommandRegexes(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // A `//` line-comment marker's own slashes are not a regex delimiter.
    // Without this, a comment that opens with `//` and later contains one
    // more `/` (a path, a URL, a `$(git rev-parse origin/<branch>)` example)
    // reads as a matched `/…/` pair spanning the marker to that later
    // slash, and the prose in between can spuriously contain a shell binary
    // bounded by spaces — a false command-regex finding on plain prose.
    const trimmed = line.trimStart()
    const scanLine = trimmed.startsWith('//') ? trimmed.slice(2) : line
    REGEX_LITERAL.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = REGEX_LITERAL.exec(scanLine)) !== null) {
      const body = m[1]!
      const binary = commandShapeBinary(body)
      if (binary !== undefined) {
        findings.push({ line: i + 1, text: line.trim(), binary })
      }
    }
  }
  return findings
}

export function isHookFile(filePath: string): boolean {
  return (
    normalizePath(filePath).includes('/.claude/hooks/') &&
    !normalizePath(filePath).includes('/node_modules/') &&
    // This guard's own source + tests discuss the banned shape.
    !normalizePath(filePath).includes('/no-hook-cmd-regex-guard/') &&
    /\.(?:c|m)?ts$/.test(filePath)
  )
}

export const check = editGuard((filePath, content, payload) => {
  if (!isHookFile(filePath)) {
    return undefined
  }
  const text = content ?? ''
  if (!text) {
    return undefined
  }
  const findings = findCommandRegexes(text)
  if (findings.length === 0) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return notify(
      `no-hook-cmd-regex-guard: ${findings.length} command-shaped regex(es) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
  }
  const lines = findings
    .map(
      f => `  ${filePath}:${f.line}  (matches \`${f.binary}\`)\n    ${f.text}`,
    )
    .join('\n')
  return block(
    `no-hook-cmd-regex-guard: refusing to introduce a regex that parses a shell command.\n` +
      `\n` +
      `${lines}\n` +
      `\n` +
      `Use the AST parser instead of regex (CLAUDE.md "prefer AST-based parsing"):\n` +
      `  import { commandsFor, parseCommands, findInvocation } from '../_shared/shell-command.mts'\n` +
      `\n` +
      `  // instead of:  /\\bgit\\s+push\\b/.test(command)\n` +
      `  commandsFor(command, 'git').some(c => c.args.includes('push'))\n` +
      `\n` +
      `The parser sees through && / | / ; chains, quoting, and $(…) and\n` +
      `won't false-positive on a literal "git push" inside a grep arg.\n` +
      `\n` +
      `Bypass (e.g. the regex matches tool stdout, not a command line):\n` +
      `  type "${BYPASS_PHRASE}" in a recent message.\n`,
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
