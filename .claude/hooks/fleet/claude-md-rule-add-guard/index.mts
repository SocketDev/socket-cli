#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-md-rule-add-guard.
//
// Blocks HAND-ADDING a new rule to CLAUDE.md and routes it through
// `scripts/fleet/codify-rule.mts` instead. Adding a rule by hand means
// re-fighting the 40KB whole-file cap + the per-`###`-section ≤8-line cap
// + the defer-to-`docs/agents.md/<scope>/` split every single time. The
// codify-rule script owns that: given a recorded memory file it uses the
// socket-lib AI helper to write the terse CLAUDE.md bullet within budget
// AND author the matching detail doc. This guard makes the script the path.
//
// Fires ONLY when an Edit/Write to a `CLAUDE.md` adds a NEW rule surface:
//   - a new `### ` section heading, or
//   - a new `- ` bullet carrying a 🚨 hard-rule marker or an enforcer
//     citation (`.claude/hooks/` / `socket/<rule>` / `scripts/fleet/check/`).
// It does NOT fire on rewording an existing line, on non-CLAUDE.md files,
// or on the sanctioned writers:
//   - FLEET_SYNC=1 (the cascade copies the canonical CLAUDE.md verbatim).
//   - SOCKET_CODIFY_RULE=1 (the codify-rule.mts agent's own write).
//
// Exit 2 = block with the route-through message. Bypass: `Allow
// claude-md-rule-add bypass` for the rare genuine manual edit.
//
// Fails open on parse / payload errors (a guard bug must not block edits).

import process from 'node:process'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow claude-md-rule-add bypass'

// True when the edited path is a CLAUDE.md (the repo-root or template copy).
export function isClaudeMd(filePath: string): boolean {
  return /(?:^|\/)CLAUDE\.md$/.test(filePath.replaceAll('\\', '/'))
}

// True when the new content introduces a new rule surface: a `### ` heading or
// a `- ` bullet that carries a hard-rule marker / enforcer citation. Scans the
// added text (the Edit new_string / Write content); a reword that doesn't add a
// heading or a marked bullet won't match.
export function addsRuleSurface(content: string): boolean {
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // A new `### ` section is always a rule-surface add.
    if (/^#{3,4}\s+\S/.test(line)) {
      return true
    }
    // A new `- ` bullet that carries a hard-rule marker or an enforcer
    // citation is a codifiable rule (not prose).
    if (/^\s*-\s/.test(line)) {
      if (
        line.includes('🚨') ||
        line.includes('.claude/hooks/') ||
        /\bsocket\/[a-z-]+/.test(line) ||
        line.includes('scripts/fleet/check/')
      ) {
        return true
      }
    }
  }
  return false
}

await withEditGuard((filePath, content, payload) => {
  if (!isClaudeMd(filePath) || !content) {
    return
  }
  // Sanctioned writers: the cascade (verbatim copy) + the codify script's
  // own agent write. Both legitimately add rule surfaces.
  if (
    process.env['FLEET_SYNC'] === '1' ||
    process.env['SOCKET_CODIFY_RULE'] === '1'
  ) {
    return
  }
  if (!addsRuleSurface(content)) {
    return
  }
  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 8)
  ) {
    return
  }
  process.stderr.write(
    [
      '🚨 claude-md-rule-add-guard: blocked a hand-added CLAUDE.md rule.',
      '',
      `  File:  ${filePath}`,
      '',
      '  Adding a rule by hand re-fights the 40KB whole-file cap, the per-`###`',
      '  section ≤8-line cap, and the defer-to-docs split every time. Route it',
      '  through the codify-rule script, which uses the AI helper to write the',
      '  terse CLAUDE.md bullet within budget AND author the detail doc:',
      '',
      '    1. Record the lesson as a memory file (frontmatter + the *why*).',
      '    2. node scripts/fleet/codify-rule.mts --memory <path> --apply',
      '',
      '  It targets docs/agents.md/{fleet,repo}/<topic>.md + the right CLAUDE.md',
      '  section automatically.',
      '',
      `  Genuine one-off manual edit? Type "${BYPASS_PHRASE}".`,
    ].join('\n') + '\n',
  )
  process.exitCode = 2
})
