#!/usr/bin/env node
// Claude Code PreToolUse hook — defer-to-script-nudge.
//
// A skill (SKILL.md) / command (.claude/commands/**/*.md) is a THIN wrapper —
// the heavy lifting belongs in a backing `.mts` script it INVOKES, not inline
// in the markdown. Inline logic isn't tested, linted, or reusable. This NUDGES
// (never blocks) when an edited skill/command embeds a large fenced code block
// (bash/js/ts/…) without referencing a backing `scripts/**.mts` script.
//
// NUDGE, not a guard: whether a block is "logic to extract" vs a documentation
// "example" is a judgment call, so this surfaces the smell rather than gating.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

const HEAVY_LINES = 12

// A skill or command markdown doc — the thin-wrapper surface this rule covers.
export function isSkillOrCommandDoc(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  // Anchored to a `.claude/` segment, then either a SKILL.md under skills/ or
  // any .md under commands/.
  return /(?:^|\/)\.claude\/(?:commands\/.+\.md|skills\/.+\/SKILL\.md)$/.test(
    normalized,
  )
}

// Line count of the largest fenced LOGIC code block. The regex captures the
// body between a ```` ```<lang> ```` open fence (logic languages only) and its
// closing fence; `[^]*?` spans newlines non-greedily so each block matches once.
export function maxCodeBlockLines(content: string): number {
  const re =
    /```(?:bash|sh|shell|js|ts|mjs|cjs|mts|cts|javascript|typescript|python|py)\b([^]*?)```/g
  let max = 0
  let m: RegExpExecArray | null = re.exec(content)
  while (m) {
    const lines = m[1]!.split('\n').length
    if (lines > max) {
      max = lines
    }
    m = re.exec(content)
  }
  return max
}

// True when the doc references a backing `.mts` in ANY of the fleet's deferral
// conventions: a `scripts/**.mts` path, a co-located `.claude/skills/**.mts`, or
// a relative co-located `lib/**.mts` / `run.mts` the skill invokes (the dominant
// skill-backing shape). Scans the markdown content, not a shell command line.
export function referencesScript(content: string): boolean {
  return /(?:\bscripts\/[^\s)'"]*\.mts|\.claude\/skills\/[^\s)'"]*\.mts|\blib\/[^\s)'"]*\.mts|\brun\.mts)\b/.test(
    content,
  )
}

// A `user-invocable: false` skill is a REFERENCE/doc — its fenced blocks are
// examples, not an operation with logic to extract — so the thin-wrapper rule
// doesn't apply and a large example block is not a smell.
export function isReferenceSkill(content: string): boolean {
  return /^user-invocable:\s*false\b/m.test(content)
}

export const hook = defineHook({
  check: editGuard((filePath, content) => {
    if (
      !content ||
      !isSkillOrCommandDoc(filePath) ||
      isReferenceSkill(content) ||
      maxCodeBlockLines(content) <= HEAVY_LINES ||
      referencesScript(content)
    ) {
      return undefined
    }
    return notify(
      [
        '[defer-to-script-nudge] this skill/command embeds heavy inline logic.',
        '',
        `  File: ${filePath}`,
        '',
        `  A fenced code block over ${HEAVY_LINES} lines with no backing \`.mts\``,
        '  reference (`scripts/**.mts`, a co-located `lib/*.mts`, or `run.mts`) —',
        '  inline logic in a skill/command is untested, unlinted, and not',
        '  reusable. Move it to a script and invoke that from the markdown so the',
        '  skill stays a thin wrapper.',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  triggers: ['SKILL.md', '/commands/'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
