#!/usr/bin/env node
// Claude Code Stop hook — disowned-dirt-guard.
//
// Every agent works in its OWN git worktree, so uncommitted paths in the
// primary checkout always belong to the session that is stopping — there is
// no rival session to hand them to. A turn-end reply that attributes dirty /
// uncommitted / WIP state to a "parallel session", "another session", or a
// "sibling session" is disowning its own work: the paths never get landed,
// and the excuse survives review because it sounds plausible. This guard
// blocks turn-end so the reply, and the dirt, get handled — commit the
// paths logically, or say precisely why they cannot be committed yet. It
// blocks on every turn-end, retries included — see the note at the block.
// Bypass: `Allow disowned-dirt bypass`.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  readLastAssistantTurnText,
  stripCodeFences,
} from '../_shared/transcript.mts'

const NAME = 'disowned-dirt-guard'

// A session-attribution phrase: "parallel session", "sibling session's",
// "the other session", "rival session", "co-session" — with an optional
// agent-brand word in the middle ("another <agent> session").
const SESSION_ATTRIBUTION = String.raw`(?:parallel|another|other|sibling|rival|co)[-\s](?:\w+[-\s])?session(?:['’]s)?`

// Dirt vocabulary: the states a stopping session tries to hand off.
const DIRT_STATE = String.raw`(?:dirty|uncommitted|unstaged|WIP|in[-\s]flight (?:work|edits?|refactor|files?)|left (?:alone|to (?:them|its owner|their owner)))`

// Both orderings, within one sentence-ish window (no period/newline between).
export const DISOWNED_DIRT_RE = new RegExp(
  `(?:${SESSION_ATTRIBUTION}[^.\\n]{0,120}${DIRT_STATE})|(?:${DIRT_STATE}[^.\\n]{0,120}${SESSION_ATTRIBUTION})`,
  'i',
)

export function findDisownedDirt(replyText: string): string | undefined {
  const match = DISOWNED_DIRT_RE.exec(stripCodeFences(replyText))
  return match ? match[0] : undefined
}

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const rawText = readLastAssistantTurnText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const hit = findDisownedDirt(rawText)
  if (!hit) {
    return undefined
  }
  const message =
    `[${NAME}] The reply attributes uncommitted state to another session:\n` +
    `  Saw:    “${hit.slice(0, 160)}”\n` +
    `  Rule:   every agent works in its own git worktree — dirty paths in\n` +
    `          the primary checkout belong to THIS session, always.\n` +
    `  Fix:    land the paths (surgical: \`git commit -o <file>\`, logical\n` +
    `          commits), or state the concrete blocker — never a rival\n` +
    `          session. Bypass: \`Allow disowned-dirt bypass\`.`
  // Blocks even mid-retry of another Stop guard. Degrading to a notice there
  // opened a real hole: a reply being rewritten to satisfy a DIFFERENT guard
  // — `dirty-worktree-stop-guard` above all, which demands the files be
  // committed — is under direct pressure to explain why paths are still
  // uncommitted, and "a parallel session owns them" is the nearest excuse.
  // That retry is exactly when `stop_hook_active` is set, so the one turn
  // where the violation is likeliest was the one turn the guard only
  // whispered. The two-guards-deadlock worry does not apply: this guard reads
  // the reply text and nothing else, so rewording the attribution always
  // satisfies it, and rewording cannot dirty the tree that
  // `dirty-worktree-stop-guard` is waiting on.
  return block(message)
}

export const hook = defineHook({
  bypass: ['disowned-dirt'],
  check,
  event: 'Stop',
  type: 'guard',
})
void runHook(hook, import.meta.url)
