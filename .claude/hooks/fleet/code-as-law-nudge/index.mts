#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook — code-as-law-nudge.
 *
 * "Code is law" means a rule is REAL only once it exists as executable code —
 * a `.mts` check, hook, or lint rule. The failure this catches is writing a
 * behavior change as if the tool were a person who could be persuaded:
 * "teach the guard to skip ignored files", "make the checker aware of
 * untracked paths". That phrasing reads like a decision but ships nothing. A
 * reader cannot tell whether the code was written, and the sentence names no
 * file, function, or condition anyone could verify.
 *
 * The correction is to name the code. Instead of "teach the guard to skip
 * ignored files", write "in `_shared/benign-untracking.mts`, exclude a staged
 * deletion whose path is gitignored and still on disk". Same idea, except it
 * points at a file and states a condition, so it can be reviewed and it can
 * be wrong.
 *
 * REMINDER (exit 0 + stderr), never a block. The phrasing is sometimes right:
 * prose ABOUT teaching, a quote, or a doc explaining this very rule. A nudge
 * lets those through while still catching the reflex.
 *
 * Scope: Edit / MultiEdit / Write. Skips the surfaces that necessarily quote
 * the pattern to define it — this hook's own directory, the backing doc, and
 * the rules tree — the same self-filtering every marker-aware scanner needs.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// Pre-flight triggers: the dispatcher skips importing this hook unless the raw
// payload contains one of these substrings. Every pattern below requires one
// of these verbs, so they are necessary substrings of any nudge-worthy write.
export const triggers: readonly string[] = [
  'aware',
  'smarter',
  'teach',
  'understand',
]

// Surfaces that must spell the pattern out in order to define or discuss it.
// Without this, the hook fires on its own source and on the doc that explains
// it — the self-match trap that makes a scanner cry wolf on every edit.
const SELF_EXEMPT = [
  '.claude/hooks/fleet/code-as-law-nudge/',
  '.claude/rules/',
  'docs/agents.md/fleet/code-is-law.md',
  'docs/agents.md/fleet/hook-registry.md',
]

// Each pattern wants a vague verb aimed at a THING — the tool, the guard, the
// checker. Requiring an object plus a following `to`/`about`/`that` keeps the
// match on "change this code" sentences and off ordinary prose about people
// learning something.
const VAGUE_INTENT_PATTERNS: ReadonlyArray<{ hint: string; re: RegExp }> = [
  {
    hint: 'teach X to …',
    re: /\bteach(?:es|ing)?\s+(?:it\s+|our\s+|the\s+|them\s+)?\w+\s+(?:about|that|to)\b/i,
  },
  {
    hint: 'make X aware of …',
    re: /\bmakes?\s+(?:it\s+|the\s+|them\s+)?\w+\s+(?:aware\s+of|smarter\s+about|understand)\b/i,
  },
  {
    hint: 'have X understand …',
    re: /\bha(?:s|ve)\s+(?:it\s+|the\s+)?\w+\s+understand\b/i,
  },
]

/**
 * True when this path is one of the surfaces that must quote the pattern.
 */
export function isSelfExempt(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return SELF_EXEMPT.some(fragment => normalized.includes(fragment))
}

/**
 * The vague-intent phrasings present in `content`, in the order the patterns
 * are declared. Empty when the text names its code plainly.
 */
export function vagueIntentHints(content: string): string[] {
  const hints: string[] = []
  for (const { hint, re } of VAGUE_INTENT_PATTERNS) {
    if (re.test(content)) {
      hints.push(hint)
    }
  }
  return hints
}

export const check = editGuard((filePath, content) => {
  if (!content || isSelfExempt(filePath)) {
    return undefined
  }
  const hints = vagueIntentHints(content)
  if (!hints.length) {
    return undefined
  }
  return notify(
    [
      '[code-as-law-nudge] This describes a behavior change without naming the code.',
      '',
      `  Phrasing: ${hints.join(', ')}`,
      '',
      '  A tool is edited, not persuaded. Written this way, a reader cannot',
      '  tell whether the code exists yet, and the sentence names no file or',
      '  condition anyone could check.',
      '',
      '  Name the code instead:',
      '',
      '    before: teach the guard to skip ignored files',
      '    after:  in _shared/benign-untracking.mts, exclude a staged',
      '            deletion whose path is gitignored and still on disk',
      '',
      '  When the rule has no code yet, that IS the finding — write the .mts',
      '  check, hook, or lint rule, then describe what it does.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
