/*
 * @file Claude Code PreToolUse hook — claude-md-rule-add-guard.
 *
 * CLAUDE.md is a terse INDEX: every rule is a one-liner that points to
 * docs/agents.md/{fleet,repo}/<topic>.md, where the detail lives. This guard
 * keeps a HAND-ADDED rule in that shape so the index can't accrete inline
 * prose — the meat belongs in the linked doc, not here.
 *
 * Fires ONLY when an Edit/Write to a `CLAUDE.md` adds a rule surface —
 *   - a new `### `/`#### ` section, OR
 *   - a marked `- ` bullet (carries 🚨 / `.claude/hooks/` / `socket/<rule>` /
 *     `scripts/fleet/check/`) —
 * whose added text does NOT link a `docs/agents.md/{fleet,repo}/` topic doc.
 * A rule whose text carries the doc link is the canonical shape and is allowed
 * (a whole section pasted with its `Detail:` link passes; a lone marked bullet
 * must carry the link itself). PLAIN bullets and prose rewording add no rule
 * surface and are always allowed; runaway section size is capped separately by
 * claude-md-section-size-guard. Applies to the fleet block AND the per-repo
 * postamble (fleet rules link `docs/agents.md/fleet/...`, per-repo rules link
 * `docs/agents.md/repo/...`).
 *
 * Does NOT fire on rewording, on plain bullets, on non-CLAUDE.md files, or on
 * the sanctioned writers:
 *   - FLEET_SYNC=1 (the cascade copies the canonical CLAUDE.md verbatim).
 *   - SOCKET_CODIFY_RULE=1 (the codify-rule.mts agent's own write).
 *
 * Exit 2 = block: add a docs/agents.md/{fleet,repo}/<topic>.md link (and move
 * the detail into that doc) or run codify-rule.mts to author both. Bypass:
 * `Allow claude-md-rule-add bypass` for the rare self-contained rule that
 * genuinely needs no doc.
 *
 * Fails open on parse / payload errors (a guard bug must not block edits).
 */

import process from 'node:process'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow claude-md-rule-add bypass'

const DOC_LINK_RE = /docs\/agents\.md\/(?:fleet|repo)\//

// True when the edited path is a CLAUDE.md (the repo-root or template copy).
export function isClaudeMd(filePath: string): boolean {
  return /(?:^|\/)CLAUDE\.md$/.test(filePath.replaceAll('\\', '/'))
}

// True when a `- ` bullet carries a hard-rule marker / enforcer citation — a
// rule list-item, which (like a section) must point to a detail doc. A plain
// bullet with none of these markers is prose, not a rule.
function isMarkedBullet(line: string): boolean {
  if (!/^\s*-\s/.test(line)) {
    return false
  }
  return (
    line.includes('🚨') ||
    line.includes('.claude/hooks/') ||
    /\bsocket\/[a-z-]+/.test(line) ||
    line.includes('scripts/fleet/check/')
  )
}

// True when the new content adds a rule surface — a `### `/`#### ` section OR a
// marked `- ` bullet — but does NOT link a docs/agents.md/{fleet,repo}/<topic>.md
// detail doc anywhere in the added text. That undeferred rule is the one shape
// this guard blocks. A rule whose added text carries the doc link is the
// canonical terse-index shape (allowed); plain bullets and prose rewording add
// no rule surface and are allowed too.
export function addsUndeferredRule(content: string): boolean {
  const lines = content.split('\n')
  let hasRuleSurface = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^#{3,4}\s+\S/.test(line) || isMarkedBullet(line)) {
      hasRuleSurface = true
      break
    }
  }
  if (!hasRuleSurface) {
    return false
  }
  return !DOC_LINK_RE.test(content)
}

export const check = editGuard((filePath, content, payload) => {
  if (!isClaudeMd(filePath) || !content) {
    return undefined
  }
  // Sanctioned writers: the cascade (verbatim copy) + the codify script's
  // own agent write. Both legitimately add rules.
  if (
    process.env['FLEET_SYNC'] === '1' ||
    process.env['SOCKET_CODIFY_RULE'] === '1'
  ) {
    return undefined
  }
  if (!addsUndeferredRule(content)) {
    return undefined
  }
  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 8)
  ) {
    return undefined
  }
  return block(
    [
      '🚨 claude-md-rule-add-guard: a new CLAUDE.md rule needs a detail-doc link.',
      '',
      `  File:  ${filePath}`,
      '',
      '  CLAUDE.md is a terse index — every rule (a new `### ` section OR a',
      '  marked `- ` bullet) points to its detail doc, where the meat lives:',
      '',
      '    - [fleet-block rule](docs/agents.md/fleet/<topic>.md)',
      '    - [per-repo rule](docs/agents.md/repo/<topic>.md)',
      '',
      '  Add the link and move the detail into that doc, or let codify-rule.mts',
      '  author both:',
      '',
      '    node scripts/fleet/codify-rule.mts --memory <path> --apply',
      '',
      '  A plain (unmarked) bullet or a reword is NOT blocked. A genuinely',
      `  self-contained rule that needs no doc? Type "${BYPASS_PHRASE}".`,
    ].join('\n'),
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
