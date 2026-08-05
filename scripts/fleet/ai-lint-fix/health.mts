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
 *   The no-op family (`createNoOpTracker`, `buildNoOpAbortMessage`,
 *   `fileDigest`) covers the quietest failure of all: a spawn that exits 0
 *   with findings to fix while a hook or permission block denies every Edit,
 *   leaving the target byte-identical.
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

import { discoverAiAgents } from '@socketsecurity/lib-stable/ai/discover'

import { runCommandQuiet } from '../util/run-command.mts'

import type { AiAgentName } from '@socketsecurity/lib-stable/ai/types'

export type CliFailureKind =
  | 'launcher-broken'
  | 'no-op'
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
  'no-op':
    'the spawn completed without touching its target file — a repo hook or permission block is denying the Edit tool inside the headless session (incident shape: an inherited CODEX_COMPANION_SESSION_ID made codex-session-budget-guard treat every spawn as an over-budget companion). Read the captured spawn output below for the blocking message, fix that block, then re-run `pnpm run fix`.',
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
 * the npm launcher without its platform binary is the incident shape.
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
 * Consecutive completed-but-zero-diff spawns that abort the batch. Mirrors the
 * environmental-failure threshold: when two spawns in a row finish "cleanly"
 * without touching their target, every remaining spawn is hitting the same
 * wall (a hook denying Edit, a permission block) and each one burns real
 * model spend for nothing.
 */
export const NO_OP_ABORT_THRESHOLD = 2

/**
 * Everything the abort block needs to name about a spawn that completed with
 * findings but produced no diff: the exact invocation and its full output.
 */
export interface NoOpSpawnReceipt {
  readonly argv: readonly string[]
  readonly exitCode: number
  readonly file: string
  readonly findings: number
  readonly stderr: string
  readonly stdout: string
}

export interface NoOpTracker {
  /**
   * Register a spawn that actually changed its target file. Resets the streak.
   */
  recordEdit: () => void
  /**
   * Register a completed spawn with findings and a zero diff. Returns the
   * current consecutive-no-op streak.
   */
  recordNoOp: (receipt: NoOpSpawnReceipt) => number
  /**
   * Receipts for the current streak, oldest first. Cleared on a real edit.
   */
  receipts: () => readonly NoOpSpawnReceipt[]
}

/**
 * Track consecutive no-op spawns across a batch. A real edit resets the
 * streak; `NO_OP_ABORT_THRESHOLD` consecutive no-ops mean the batch is
 * structurally broken and the orchestrator aborts loud instead of completing
 * a pass that fixed nothing.
 */
export function createNoOpTracker(): NoOpTracker {
  let streakReceipts: NoOpSpawnReceipt[] = []
  return {
    recordEdit() {
      streakReceipts = []
    },
    recordNoOp(receipt: NoOpSpawnReceipt): number {
      streakReceipts.push(receipt)
      return streakReceipts.length
    },
    receipts(): readonly NoOpSpawnReceipt[] {
      return streakReceipts
    },
  }
}

function renderSpawnOutput(receipt: NoOpSpawnReceipt): string {
  const out = receipt.stdout.trim()
  const err = receipt.stderr.trim()
  const lines = [
    `    file: ${receipt.file} (${receipt.findings} findings, exit ${receipt.exitCode})`,
    `    argv: ${receipt.argv.join(' ')}`,
    `    stdout: ${out === '' ? '(empty)' : out.slice(0, 600)}`,
  ]
  if (err !== '') {
    lines.push(`    stderr: ${err.slice(0, 600)}`)
  }
  return lines.join('\n')
}

/**
 * Build the loud abort block for a no-op streak: What / Where / Saw vs.
 * wanted / Fix, naming each captured spawn's argv and output so the operator
 * sees the blocking message instead of a silent "completed" pass.
 */
export function buildNoOpAbortMessage(
  receipts: readonly NoOpSpawnReceipt[],
  remainingFiles: number,
): string {
  const shown = receipts.map(renderSpawnOutput).join('\n')
  return [
    `AI-fix aborting: ${receipts.length} consecutive no-op spawns.`,
    '  What:   each spawn completed (exit 0) with findings to fix but left its target file byte-identical.',
    `  Where:  ${receipts.map(r => r.file).join(', ')} (${remainingFiles} files unattempted).`,
    '  Saw:    completed spawns with zero diff; wanted: an edited file or a non-zero exit.',
    `  Fix:    ${FAILURE_REMEDY['no-op']}`,
    '  Captured spawn output:',
    shown,
  ].join('\n')
}

/**
 * Content digest of a spawn's target file, for the zero-diff check — a
 * completed spawn whose target digest did not move is a no-op. Returns
 * undefined when the file cannot be read (deleted counts as a change).
 */
export function fileDigest(filePath: string): string | undefined {
  try {
    return crypto
      .createHash('sha256')
      .update(readFileSync(filePath))
      .digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Probe whether ANY discovered AI agent CLI is present AND runnable. A PATH
 * hit alone is not health: an npm-installed launcher can resolve on PATH
 * while its native binary is missing and every spawn dies at startup.
 *
 * Tries each agent `discoverAiAgents` finds, in discovery order, and returns
 * the first one whose `--version` actually exits 0. There is no preference
 * for `claude` beyond it typically being first in that order — the fleet
 * has fallback agents, opencode, codex, gemini, and any of them running is
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
