/**
 * @file Headless Claude invocation for the ai-lint-fix step: spawn the edit-only
 *   agent per file and probe whether the claude CLI is on PATH. Wraps the
 *   lib-stable AI helpers so the orchestrator stays free of spawn detail.
 */

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import {
  buildArgs,
  pickAgent,
  spawnAiAgent,
} from '@socketsecurity/lib-stable/ai/spawn'

import type { AiEffort } from '@socketsecurity/lib-stable/ai/types'

/**
 * Env overrides for every ai-lint-fix spawn. The codex plugin's SessionStart
 * hook exports CODEX_COMPANION_SESSION_ID into EVERY session's env with that
 * session's own id, so a headless spawn started from inside an agent session
 * inherits the PARENT's id. Inside the child, that id is foreign to the
 * child's own transcript path, which is exactly the discriminator
 * codex-session-budget-guard uses for "this is a Codex companion" — so once
 * the parent session is over a minute old, the guard blocks the child's every
 * Edit call and the spawn completes having fixed nothing (the silent 215-file
 * no-op incident). The child is a fresh headless session, not a companion:
 * clear the inherited id so the guard's identity check sees no companion at
 * all. An empty string reads as absent (`codexCompanionId` requires a
 * non-empty value).
 */
export const AI_FIX_SPAWN_ENV: Readonly<Record<string, string>> = {
  CODEX_COMPANION_SESSION_ID: '',
}

export interface ClaudeFixResult {
  /**
   * The resolved agent binary name plus the lockdown flags the spawn ran
   * with — the receipt a no-op abort block names so the operator can replay
   * the exact invocation.
   */
  argv: readonly string[]
  exitCode: number
  stderr: string
  stdout: string
}

export async function runClaudeFix(
  prompt: string,
  cwd: string,
  model: string,
  effort: AiEffort,
): Promise<ClaudeFixResult> {
  // AI_PROFILE.edit = in-place edits only (Edit on existing files, no
  // Write/MultiEdit) — exactly the lint-fix contract: the prompt forbids
  // creating files. spawnAiAgent owns the --no-session-persistence /
  // --add-dir / 529-retry the hand-rolled version used to duplicate.
  // Model AND effort are picked per-file by the caller via escalateTier() —
  // see RULE_MODEL_TIER + TIER_EFFORT in rule-guidance.mts. Simple
  // regex-shaped rewrites run on Haiku/low; control-flow + caller-chain
  // rewrites run on Sonnet/medium; module-split refactors
  // (`socket/max-file-lines`) run on Opus/high. Pinning effort alongside the
  // model is the CLAUDE.md token-spend rule — a cheap model left on the
  // session's default, often high, still burns reasoning a mechanical
  // rewrite never needs.
  const options = {
    ...AI_PROFILE.edit,
    cwd,
    effort,
    env: AI_FIX_SPAWN_ENV,
    model,
    prompt,
    timeoutMs: 5 * 60 * 1000,
  }
  // Resolve the agent the spawn will pick (same discovery order) so the
  // receipt names the real invocation, then let spawnAiAgent own the spawn.
  const agent = await pickAgent(undefined, cwd)
  const argv = [agent, ...buildArgs(agent, options)]
  const { exitCode, stderr, stdout } = await spawnAiAgent(options)
  return { argv, exitCode, stderr, stdout }
}

export async function hasClaudeCli(cwd: string): Promise<boolean> {
  // discoverAiAgents resolves each known agent CLI via `which`; claude
  // is present iff it's a key in the returned map.
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  return 'claude' in discovered
}
