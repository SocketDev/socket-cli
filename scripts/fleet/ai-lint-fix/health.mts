/**
 * @file Health probe + failure classification for the ai-lint-fix AI leg.
 *   Headless/wave runs are where the AI residue pass runs most and where its
 *   environment breaks quietest: a launcher whose native binary was never
 *   installed, a workspace-trust dialog no headless spawn can answer, or a
 *   tool-policy mismatch between the spawn profile and the CLI version.
 *   `probeAiCli` catches a broken launcher BEFORE any per-file spawn (a
 *   `--version` exec, not just a PATH hit) — it tries every AI agent CLI
 *   `discoverAiAgents` finds (claude and its fallbacks alike, no hardcoded
 *   preference) and reports the first one that actually runs.
 *   `classifyAiFailure` turns a failed spawn's output into a named failure
 *   mode with a copy-paste remedy so the orchestrator can report loud and
 *   bail early instead of burning a 5-minute timeout per remaining file.
 */

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'

import { runCommandQuiet } from '../util/run-command.mts'

import type { AiAgentName } from '@socketsecurity/lib-stable/ai/types'

export type CliFailureKind =
  | 'launcher-broken'
  | 'silent-exit'
  | 'tool-policy'
  | 'workspace-trust'

export interface ClassifiedFailure {
  kind: CliFailureKind
  remedy: string
}

export interface CliProbe {
  detail?: string | undefined
  ok: boolean
  reason?: 'launcher-broken' | 'not-on-path' | undefined
}

export interface AiCliProbe extends CliProbe {
  agent?: AiAgentName | undefined
  bin?: string | undefined
  /**
   * Every agent name discovery found, healthy or not — lets a caller report
   * which clients were tried.
   */
  tried?: readonly AiAgentName[] | undefined
}

const LAUNCHER_BROKEN_RE = /native binary|claude install/i
// CLI stderr tells for a tool-policy failure: a rejected tool name
// (multiedit / unknown tool / invalid tool) or "tool [name ]not
// found|recognized" (optional "name " in the middle).
const TOOL_POLICY_RE =
  /multiedit|unknown tool|invalid tool|tool (?:name )?not (?:found|recognized)/i
// CLI stderr tells for an untrusted-workspace prompt; `workspace.?trust`
// tolerates a space, hyphen, or nothing between the words.
const WORKSPACE_TRUST_RE = /do you trust|trust the files|workspace.?trust/i

export const FAILURE_REMEDY: Readonly<Record<CliFailureKind, string>> = {
  'launcher-broken':
    'the claude launcher is installed but its native binary is not — run `claude install` on this machine, then re-run `pnpm run fix`.',
  'silent-exit':
    'the subprocess produced no output before exiting — the common cause is an interactive prompt (workspace trust) hanging until the timeout; open `claude` interactively once in this repo to record trust, then re-run `pnpm run fix`.',
  'tool-policy':
    'the spawn profile names a tool this claude CLI version does not recognize — compare `claude --version` against AI_PROFILE in @socketsecurity/lib-stable and update whichever is stale.',
  'workspace-trust':
    'headless spawns cannot answer the workspace-trust dialog — open `claude` interactively once in this repo to record trust, then re-run `pnpm run fix`.',
}

/**
 * Classify a failed AI-fix spawn's combined output into a known environmental
 * failure mode. Returns undefined for file-specific failures (bad prompt, API
 * error, genuine timeout on a hard file) that do NOT predict the next spawn
 * failing the same way.
 */
export function classifyAiFailure(
  stdout: string,
  stderr: string,
): ClassifiedFailure | undefined {
  const output = `${stdout}\n${stderr}`
  if (output.trim() === '') {
    return { kind: 'silent-exit', remedy: FAILURE_REMEDY['silent-exit'] }
  }
  if (LAUNCHER_BROKEN_RE.test(output)) {
    return {
      kind: 'launcher-broken',
      remedy: FAILURE_REMEDY['launcher-broken'],
    }
  }
  if (WORKSPACE_TRUST_RE.test(output)) {
    return {
      kind: 'workspace-trust',
      remedy: FAILURE_REMEDY['workspace-trust'],
    }
  }
  if (TOOL_POLICY_RE.test(output)) {
    return { kind: 'tool-policy', remedy: FAILURE_REMEDY['tool-policy'] }
  }
  return undefined
}

/**
 * Interpret a `<agent> --version` exec result. Exit 0 means the launcher can
 * actually run; anything else means it resolved on PATH but cannot execute
 * (the npm launcher without its platform binary is the incident shape).
 */
export function evaluateCliProbe(result: {
  exitCode: number
  stderr: string
  stdout: string
}): CliProbe {
  if (result.exitCode === 0) {
    return { ok: true }
  }
  const detail =
    result.stderr.split('\n')[0]?.trim() ||
    result.stdout.split('\n')[0]?.trim() ||
    `exit ${result.exitCode}`
  return { detail, ok: false, reason: 'launcher-broken' }
}

/**
 * Probe whether ANY discovered AI agent CLI is present AND runnable. A PATH
 * hit alone is not health: an npm-installed launcher can resolve on PATH
 * while its native binary is missing and every spawn dies at startup.
 *
 * Tries each agent `discoverAiAgents` finds, in discovery order, and returns
 * the first one whose `--version` actually exits 0. There is no preference
 * for `claude` beyond it typically being first in that order — the fleet
 * has fallback agents (opencode, codex, gemini), and any of them running is
 * a healthy leg. `ok: false` with `reason: 'launcher-broken'` means agents
 * were found but none could execute; `reason: 'not-on-path'` means
 * discovery found none at all.
 */
export async function probeAiCli(cwd: string): Promise<AiCliProbe> {
  const discovered = await discoverAiAgents({ repoRoot: cwd })
  const entries = Object.entries(discovered) as Array<[AiAgentName, string]>
  const tried = entries.map(([agent]) => agent)
  if (entries.length === 0) {
    return { ok: false, reason: 'not-on-path', tried }
  }
  let detail: string | undefined
  for (const [agent, bin] of entries) {
    const result = await runCommandQuiet(bin, ['--version'], {
      cwd,
      timeout: 15_000,
    })
    const probe = evaluateCliProbe(result)
    if (probe.ok) {
      return { agent, bin, ok: true, tried }
    }
    detail = probe.detail
  }
  return { detail, ok: false, reason: 'launcher-broken', tried }
}
