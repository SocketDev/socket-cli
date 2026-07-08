#!/usr/bin/env node
// Claude Code PreToolUse hook — convo-prose-nudge.
//
// Fires when Claude is about to run a `gh pr create|edit|comment` or
// `gh issue create|edit|comment` command whose `--body`/`-b` value contains
// AI-scaffolding antipatterns: throat-clearing openers ("I've gone ahead
// and…", "Let me…", "In this PR, I…", "I took a look and…"), closing filler
// ("Let me know if you have any questions!", "Hope this helps!"), and honesty
// framing (the shared _shared/honesty-framing.mts matcher: "to be honest",
// "honestly", "Frankly,", …).
//
// REMINDER (exit 0 + stderr), never a block. The prose skill
// (.claude/skills/fleet/prose/SKILL.md, references/conversational.md) is the
// correction path — rewrite the body through it before re-running the command.
//
// Triggers on Bash commands that contain 'gh pr' or 'gh issue' (fast pre-
// dispatch filter). Uses the fleet AST parser (commandsFor) to detect `gh`
// invocations — no regex command matching. A parse failure exits 0 silently
// (fail-open — a nudge must never block on its own bug).

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  HONESTY_FRAMING_RE,
  HONESTY_LABEL,
} from '../_shared/honesty-framing.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import type { Command } from '../_shared/shell-command.mts'

// Fast pre-dispatch substrings — the dispatcher skips this hook unless one
// appears in the raw payload.
export const triggers: readonly string[] = ['gh issue', 'gh pr']

// The `gh` subcommands that take a --body and post to GitHub.
const PR_ISSUE_SUBCOMMANDS = new Set(['comment', 'create', 'edit'])
const PR_ISSUE_TOPIC = new Set(['issue', 'pr'])

// Each entry: a human-readable label and the regex to test against the BODY
// TEXT (not a shell command — these patterns are safe from no-hook-cmd-regex).
const ANTIPATTERN_CHECKS: ReadonlyArray<{
  readonly label: string
  readonly re: RegExp
}> = [
  { label: 'filler: "Hope this helps"', re: /Hope this helps/i },
  { label: 'opener: "I\'ve gone ahead"', re: /I['']ve gone ahead/i },
  { label: 'opener: "I took a look"', re: /\bI took a look\b/i },
  { label: 'opener: "In this PR, I"', re: /\bIn this PR[,.]?\s+I\b/i },
  {
    label: 'filler: "Let me know if you have any questions"',
    re: /Let me know if you have any questions/i,
  },
  { label: 'opener: "Let me"', re: /\bLet me\b/i },
  // Honesty framing is the shared _shared/honesty-framing.mts source — one
  // matcher across every surface that bans "honest"/"honestly" filler.
  { label: HONESTY_LABEL, re: HONESTY_FRAMING_RE },
]

/**
 * True when the parsed `gh` Command targets a PR/issue posting subcommand
 * (create / edit / comment on pr / issue).
 */
export function isGhPrOrIssuePost(cmd: Command): boolean {
  // args[0] = topic (pr / issue), args[1] = subcommand (create / edit / comment)
  // but global flags like --repo can appear before the topic, so scan.
  const nonFlags = cmd.args.filter(a => !a.startsWith('-'))
  if (nonFlags.length < 2) {
    return false
  }
  return (
    PR_ISSUE_TOPIC.has(nonFlags[0]!) && PR_ISSUE_SUBCOMMANDS.has(nonFlags[1]!)
  )
}

/**
 * Extract the value of `--body`/`-b` from the arg list of a parsed `gh`
 * Command. Returns `undefined` when no body argument is found.
 */
export function extractBodyArg(cmd: Command): string | undefined {
  const { args } = cmd
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--body' || arg === '-b') {
      return args[i + 1]
    }
    if (arg.startsWith('--body=')) {
      return arg.slice('--body='.length)
    }
  }
  return undefined
}

/**
 * Return the label strings for every antipattern that matched in `body`.
 * An empty array means no hits.
 */
export function findAiScaffoldingPhrases(body: string): string[] {
  const hits: string[] = []
  for (let i = 0, { length } = ANTIPATTERN_CHECKS; i < length; i += 1) {
    const entry = ANTIPATTERN_CHECKS[i]!
    if (entry.re.test(body)) {
      hits.push(entry.label)
    }
  }
  return hits
}

export const check = bashGuard(command => {
  const ghCmds = commandsFor(command, 'gh')
  for (let i = 0, { length } = ghCmds; i < length; i += 1) {
    const cmd = ghCmds[i]!
    if (!isGhPrOrIssuePost(cmd)) {
      continue
    }
    const body = extractBodyArg(cmd)
    if (!body) {
      continue
    }
    const hits = findAiScaffoldingPhrases(body)
    if (hits.length === 0) {
      continue
    }
    return notify(
      [
        `[convo-prose-nudge] PR/issue body contains AI-scaffolding antipattern(s):`,
        ...hits.map(h => `  • ${h}`),
        '',
        'Rewrite the body through the prose skill (conversational mode) before',
        'posting — lead with the point, cut the filler:',
        '  .claude/skills/fleet/prose/SKILL.md',
        '  .claude/skills/fleet/prose/references/conversational.md',
        '',
      ].join('\n'),
    )
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
