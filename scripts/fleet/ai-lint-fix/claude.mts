/**
 * @file Headless Claude invocation for the ai-lint-fix step: spawn the edit-only
 *   agent per file and probe whether the claude CLI is on PATH. Wraps the
 *   lib-stable AI helpers so the orchestrator stays free of spawn detail.
 */

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'
import { AI_PROFILE } from '@socketsecurity/lib-stable/ai/profiles'
import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'

export async function runClaudeFix(
  prompt: string,
  cwd: string,
  model: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // AI_PROFILE.edit = in-place edits only (Edit on existing files, no
  // Write/MultiEdit) — exactly the lint-fix contract: the prompt forbids
  // creating files. spawnAiAgent owns the --no-session-persistence /
  // --add-dir / 529-retry the hand-rolled version used to duplicate.
  // The model is picked per-file by the caller via escalateTier() — see
  // RULE_MODEL_TIER in rule-guidance.mts. Simple regex-shaped rewrites
  // run on Haiku; control-flow + caller-chain rewrites run on Sonnet;
  // module-split refactors (`socket/max-file-lines`) run on Opus.
  const { exitCode, stderr, stdout } = await spawnAiAgent({
    ...AI_PROFILE.edit,
    cwd,
    model,
    prompt,
    timeoutMs: 5 * 60 * 1000,
  })
  return { exitCode, stderr, stdout }
}

export async function hasClaudeCli(cwd: string): Promise<boolean> {
  // discoverAiAgents resolves each known agent CLI via `which`; claude
  // is present iff it's a key in the returned map.
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  return 'claude' in discovered
}
