#!/usr/bin/env node
// Claude Code PostToolUse hook — long-running-task-nudge.
//
// Catches a background Workflow run, Agent, or Bash task that grinds without
// visible progress. A single background run once ground on one hard task
// for about an hour — a huge transcript, many failed iterations — before the
// orchestrator noticed. This surfaces the run after a modest threshold so the
// orchestrator verifies it is progressing and, if stuck, TaskStops it and
// researches the real root cause instead of letting it grind.
//
// Clock: PostToolUse fires after every tool call, the only event that fires
// periodically during an active turn, so it is the natural place for an
// elapsed-time check. Caveat: it fires only while the ORCHESTRATOR is itself
// calling tools. If the orchestrator sits fully idle waiting on the background
// task, the nudge lands at its next tool call, not at the exact threshold. That
// is on goal — the point is to prompt a progress check the next time it acts.
//
// Discovery: three on-disk sources.
//   1. Workflow runs at <session>/workflows/wf_*.json — runId, status, and
//      startTime in epoch ms. Terminal status ends a run; anything else runs.
//   2. Agents at <session>/subagents/agent-*.jsonl — no status field, so an
//      agent runs while its transcript mtime is fresh within the live window;
//      age is now minus the transcript ctime.
//   3. Bash tasks at <tmp>/claude-<uid>/<cwd-slug>/<session>/tasks/<id>.output,
//      rooted off the cwd rather than the transcript. Nothing on disk marks one
//      finished, so SILENCE is the measure: age is now minus the output mtime,
//      bounded above by BASH_TASK_STALE_CEILING_MS so finished tasks in a long
//      session's dir stay quiet. Symlinked entries are Agent tasks, already
//      counted by arm 2, and are skipped rather than double-reported.
// Paths anchor on os.homedir(), transcript_path, and the payload cwd; the one
// hardcoded root is the harness's own tmp dir, injectable for tests.
//
// Idempotent: warns once per task per threshold crossing. A fail-open JSON
// store maps each task id to the highest tier warned; a task re-warns only when
// it crosses a higher tier. Fail-open everywhere — a broken read never blocks a
// tool call.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  CHILD_LIVE_WINDOW_MS,
  deriveSubagentsDir,
} from '../_shared/active-edits-ledger.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveRepoRoot } from '../_shared/repo-root.mts'

// First and second (escalated) age tiers, in minutes. Named constants are the
// single source for the age math and the warn-once bookkeeping. Two minutes is
// deliberately impatient: the cost of an early "go look" is one cheap check,
// and the cost of a late one is measured in the whole silent stretch. A gate
// run once sat unexamined for nineteen minutes on the reasoning that a
// multi-language coverage lane is quiet while it works — true, and still no
// reason to have waited that long to confirm it.
export const LONGRUN_MINUTES = 2
export const LONGRUN_ESCALATE_MINUTES = 5

const MS_PER_MINUTE = 60_000

// Past this much silence a background Bash task is history, not a live
// concern: the orchestrator either handled it or the session moved on. Without
// the ceiling, every finished task in a long session's tasks dir would nudge
// on the next tool call.
export const BASH_TASK_STALE_CEILING_MS = 30 * MS_PER_MINUTE

// Store for warn-once state: .cache/<name>, dep-0 runtime state,
// never tracked. Falls back to the OS temp dir.
const STORE_NAME = 'socket-long-running-task-nudge'

// A session store older than this is swept — the session ended or went idle.
export const SEEN_STORE_TTL_MS = 60 * 60 * 1000

// Workflow statuses that mark a run as done. Anything else is treated as still
// running so a live run is never missed.
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'cancelled',
  'completed',
  'error',
  'failed',
  'killed',
])

/**
 * One background Workflow run, narrowed from its wf_*.json file.
 */
export interface WorkflowRecord {
  readonly runId: string
  readonly startTime?: number | undefined
  readonly status?: string | undefined
  readonly workflowName?: string | undefined
}

/**
 * One background Agent, narrowed from its transcript + meta companion.
 */
export interface AgentRecord {
  readonly ctimeMs: number
  readonly description?: string | undefined
  readonly id: string
  readonly mtimeMs: number
}

/**
 * One background Bash task, narrowed from its `<id>.output` file. Its mtime is
 * the only progress signal there is: nothing on disk distinguishes a finished
 * task from a running one, so SILENCE is what gets measured.
 */
export interface BashTaskRecord {
  readonly id: string
  readonly mtimeMs: number
}

/**
 * A running background task with its computed age.
 */
export interface RunningTask {
  readonly ageMs: number
  readonly id: string
  readonly kind: 'agent' | 'bash' | 'workflow'
  readonly label?: string | undefined
}

/**
 * A running task that crossed a warn tier this check.
 */
export interface WarnDecision {
  readonly ageMs: number
  readonly id: string
  readonly kind: 'agent' | 'bash' | 'workflow'
  readonly label?: string | undefined
  readonly tier: number
}

/**
 * The on-disk warn-once store: task id → highest tier already warned.
 */
export interface SeenStore {
  readonly seen: Record<string, number>
  readonly updatedAt: number
}

// ── Pure core ───────────────────────────────────────────────────────────────

/**
 * True when a workflow status marks the run as done. An absent status is
 * treated as running. Pure.
 */
export function isTerminalStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.has(status)
}

/**
 * The workflows directory for a session, the sibling of the subagents dir:
 * `<dir>/<session>.jsonl` → `<dir>/<session>/workflows`. Returns `undefined`
 * when the path is not a `.jsonl` transcript. Pure.
 */
export function deriveWorkflowsDir(
  transcriptPath: string | undefined,
): string | undefined {
  const subagentsDir = deriveSubagentsDir(transcriptPath)
  if (!subagentsDir) {
    return undefined
  }
  return path.join(path.dirname(subagentsDir), 'workflows')
}

/**
 * The session id for a transcript path — the basename minus `.jsonl`. Returns
 * `undefined` when the path is not a `.jsonl` transcript. Pure.
 */
export function sessionIdFromTranscript(
  transcriptPath: string | undefined,
): string | undefined {
  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) {
    return undefined
  }
  return path.basename(transcriptPath, '.jsonl')
}

/**
 * The highest warn tier an age has crossed: `LONGRUN_ESCALATE_MINUTES`,
 * `LONGRUN_MINUTES`, or `0` for under the first threshold. Pure.
 */
export function tierFor(ageMs: number): number {
  if (ageMs >= LONGRUN_ESCALATE_MINUTES * MS_PER_MINUTE) {
    return LONGRUN_ESCALATE_MINUTES
  }
  if (ageMs >= LONGRUN_MINUTES * MS_PER_MINUTE) {
    return LONGRUN_MINUTES
  }
  return 0
}

/**
 * The running background tasks with their ages. A workflow runs when it has a
 * `startTime` and a non-terminal status; an agent runs when its transcript
 * mtime is fresh within `liveWindowMs`. Negative ages from clock skew are
 * dropped. Pure — no IO, injectable clock.
 */
export function runningTaskAges(config: {
  agents: readonly AgentRecord[]
  bashTasks?: readonly BashTaskRecord[] | undefined
  liveWindowMs?: number | undefined
  now: number
  staleCeilingMs?: number | undefined
  workflows: readonly WorkflowRecord[]
}): RunningTask[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const liveWindowMs = cfg.liveWindowMs ?? CHILD_LIVE_WINDOW_MS
  const staleCeilingMs = cfg.staleCeilingMs ?? BASH_TASK_STALE_CEILING_MS
  const out: RunningTask[] = []
  for (const task of cfg.bashTasks ?? []) {
    // A Bash task's age IS its silence, so a run that redirects its output to
    // a log never touches this file and reads as silent for its whole
    // duration. That is the intended reading: output you cannot see is
    // progress you have not verified.
    const ageMs = cfg.now - task.mtimeMs
    if (ageMs < 0 || ageMs > staleCeilingMs) {
      continue
    }
    out.push({ ageMs, id: task.id, kind: 'bash' })
  }
  for (const wf of cfg.workflows) {
    if (typeof wf.startTime !== 'number' || isTerminalStatus(wf.status)) {
      continue
    }
    const ageMs = cfg.now - wf.startTime
    if (ageMs < 0) {
      continue
    }
    out.push({ ageMs, id: wf.runId, kind: 'workflow', label: wf.workflowName })
  }
  for (const agent of cfg.agents) {
    if (cfg.now - agent.mtimeMs > liveWindowMs) {
      continue
    }
    const ageMs = cfg.now - agent.ctimeMs
    if (ageMs < 0) {
      continue
    }
    out.push({ ageMs, id: agent.id, kind: 'agent', label: agent.description })
  }
  return out
}

/**
 * The tasks to warn about: those whose crossed tier exceeds the highest tier
 * already recorded in `seen`. This is the idempotency core — a task under the
 * first threshold, or one already warned at its current tier, is silent. Pure.
 */
export function tasksToWarn(
  running: readonly RunningTask[],
  seen: Readonly<Record<string, number>>,
): WarnDecision[] {
  const out: WarnDecision[] = []
  for (const task of running) {
    const tier = tierFor(task.ageMs)
    if (tier === 0) {
      continue
    }
    const prior = seen[task.id] ?? 0
    if (tier <= prior) {
      continue
    }
    out.push({
      ageMs: task.ageMs,
      id: task.id,
      kind: task.kind,
      label: task.label,
      tier,
    })
  }
  return out
}

/**
 * A new seen map with each warned task recorded at its crossed tier. Pure.
 */
export function mergeSeen(
  seen: Readonly<Record<string, number>>,
  warned: readonly WarnDecision[],
): Record<string, number> {
  const next: Record<string, number> = { ...seen }
  for (const decision of warned) {
    next[decision.id] = decision.tier
  }
  return next
}

/**
 * The nudge text naming each over-threshold task and its age. Pure.
 */
export function formatLongrunNudge(warned: readonly WarnDecision[]): string {
  const lines: string[] = []
  for (let i = 0, { length } = warned; i < length; i += 1) {
    const decision = warned[i]!
    const label = decision.label ? ` "${decision.label}"` : ''
    const minutes = Math.floor(decision.ageMs / MS_PER_MINUTE)
    const escalated =
      decision.tier >= LONGRUN_ESCALATE_MINUTES ? ' ESCALATED' : ''
    const prefix =
      i === 0
        ? '💡 long-running-task-nudge: verify progress (TaskGet/transcript growth) or TaskStop + root-cause; lint/format thrash → autofixer (`pnpm run fix`) first — '
        : '   '
    // A Bash task's age is silence, not runtime, and the two call for
    // different checks — read the log or `ps` the process, not TaskGet.
    const measure = decision.kind === 'bash' ? 'min silent' : 'min'
    lines.push(
      `${prefix}${decision.kind} ${decision.id}${label} — ${minutes}${measure}${escalated}`,
    )
  }
  return lines.join('\n')
}

// ── Thin fs shell ─────────────────────────────────────────────────────────

/**
 * The warn-once store dir. Prefers
 * `<repo root of projectDir>/.cache/<name>`; falls back to the OS temp dir.
 * The git-toplevel anchor is what keeps every caller on ONE store instead
 * of scattering a `.cache/` per cwd — including one inside
 * `template/base/`, the cascade payload (see _shared/repo-root.mts).
 */
export function resolveSeenStoreDir(projectDir: string | undefined): string {
  if (projectDir) {
    return path.join(resolveRepoRoot(projectDir), '.cache', 'fleet', STORE_NAME)
  }
  return path.join(
    process.env['TMPDIR'] ??
      process.env['TMP'] ??
      process.env['TEMP'] ??
      '/tmp',
    STORE_NAME,
  )
}

/**
 * The background-Bash tasks dir for a session:
 * `<tmpRoot>/claude-<uid>/<cwd with separators as dashes>/<session>/tasks`.
 * This lives under a different root than the transcript, so it is derived from
 * the cwd and the session id rather than from the transcript path. Returns
 * `undefined` when either input is missing. Pure.
 */
export function deriveBackgroundTasksDir(config: {
  cwd: string | undefined
  session: string | undefined
  tmpRoot?: string | undefined
  uid: number | undefined
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.cwd || !cfg.session || cfg.uid === undefined) {
    return undefined
  }
  const slug = normalizePath(cfg.cwd).replaceAll('/', '-')
  return path.join(
    cfg.tmpRoot ?? '/tmp',
    `claude-${cfg.uid}`,
    slug,
    cfg.session,
    'tasks',
  )
}

// Read the `<id>.output` files under a tasks dir with their mtime. SYMLINKS
// ARE SKIPPED: an Agent task is symlinked to its subagent transcript and is
// already counted by the agent arm, so following one would double-report it.
// Fail-open.
function readBashTaskRecords(tasksDir: string): BashTaskRecord[] {
  try {
    if (!existsSync(tasksDir)) {
      return []
    }
    const out: BashTaskRecord[] = []
    for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.output')) {
        continue
      }
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- statSync for mtime, not existence; we need the modification timestamp
        const stat = statSync(path.join(tasksDir, entry.name))
        out.push({
          id: entry.name.slice(0, -'.output'.length),
          mtimeMs: stat.mtimeMs,
        })
      } catch {
        // Fail-open per file.
      }
    }
    return out
  } catch {
    return []
  }
}

// The narrowed description from an agent's meta companion, or undefined.
export function readAgentDescription(
  subagentsDir: string,
  id: string,
): string | undefined {
  const metaPath = path.join(subagentsDir, `${id}.meta.json`)
  if (!existsSync(metaPath)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    const desc = parsed?.description
    return typeof desc === 'string' ? desc : undefined
  } catch {
    return undefined
  }
}

// Parse the wf_*.json workflow runs under a workflows dir. Fail-open.
function readWorkflowRecords(workflowsDir: string): WorkflowRecord[] {
  try {
    if (!existsSync(workflowsDir)) {
      return []
    }
    const out: WorkflowRecord[] = []
    for (const entry of readdirSync(workflowsDir)) {
      if (!entry.startsWith('wf_') || !entry.endsWith('.json')) {
        continue
      }
      try {
        const parsed = JSON.parse(
          readFileSync(path.join(workflowsDir, entry), 'utf8'),
        )
        if (!parsed || typeof parsed !== 'object') {
          continue
        }
        const runId =
          typeof parsed.runId === 'string'
            ? parsed.runId
            : entry.slice(0, -'.json'.length)
        out.push({
          runId,
          startTime:
            typeof parsed.startTime === 'number' ? parsed.startTime : undefined,
          status: typeof parsed.status === 'string' ? parsed.status : undefined,
          workflowName:
            typeof parsed.workflowName === 'string'
              ? parsed.workflowName
              : undefined,
        })
      } catch {
        // Fail-open per file.
      }
    }
    return out
  } catch {
    return []
  }
}

// Read the agent-*.jsonl transcripts under a subagents dir with their ctime +
// mtime and meta description. Fail-open.
function readAgentRecords(subagentsDir: string): AgentRecord[] {
  try {
    if (!existsSync(subagentsDir)) {
      return []
    }
    const out: AgentRecord[] = []
    for (const entry of readdirSync(subagentsDir)) {
      if (!entry.startsWith('agent-') || !entry.endsWith('.jsonl')) {
        continue
      }
      const id = entry.slice(0, -'.jsonl'.length)
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- statSync for ctime/mtime, not existence; we need the timestamps
        const stat = statSync(path.join(subagentsDir, entry))
        out.push({
          ctimeMs: stat.ctimeMs,
          description: readAgentDescription(subagentsDir, id),
          id,
          mtimeMs: stat.mtimeMs,
        })
      } catch {
        // Fail-open per file.
      }
    }
    return out
  } catch {
    return []
  }
}

// Read the warn-once store for a session. Returns an empty store on any error.
function readSeenStore(filePath: string): SeenStore {
  const empty: SeenStore = { seen: {}, updatedAt: 0 }
  if (!existsSync(filePath)) {
    return empty
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.seen ||
      typeof parsed.seen !== 'object'
    ) {
      return empty
    }
    return parsed as SeenStore
  } catch {
    return empty
  }
}

// Flush the warn-once store. Fail-open — a broken store must not block a call.
export function writeSeenStore(filePath: string, store: SeenStore): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(store), 'utf8')
  } catch {
    // Fail-open.
  }
}

// Expire session stores past the TTL to bound store growth. Fail-open.
export function sweepStaleSeenStores(
  storeDir: string,
  config: { now: number; ttlMs: number },
): void {
  const { now, ttlMs } = { __proto__: null, ...config } as typeof config
  try {
    if (!existsSync(storeDir)) {
      return
    }
    for (const entry of readdirSync(storeDir)) {
      if (!entry.endsWith('.json')) {
        continue
      }
      const fp = path.join(storeDir, entry)
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- statSync for mtime, not existence; we need the modification timestamp
        if (now - statSync(fp).mtimeMs > ttlMs) {
          safeDeleteSync(fp)
        }
      } catch {
        // Fail-open per file.
      }
    }
  } catch {
    // Fail-open for the whole sweep.
  }
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const transcriptPath = payload?.transcript_path
  const session = sessionIdFromTranscript(transcriptPath)
  const workflowsDir = deriveWorkflowsDir(transcriptPath)
  const subagentsDir = deriveSubagentsDir(transcriptPath)
  const tasksDir = deriveBackgroundTasksDir({
    // The tasks dir is slugged from the directory the session was launched in.
    // The payload carries it; CLAUDE_PROJECT_DIR is the agent-provided
    // fallback. Never process.cwd() — a hook runs from wherever it was
    // invoked, which would slug a different (and wrong) path.
    cwd: payload?.cwd || process.env['CLAUDE_PROJECT_DIR'] || undefined,
    session,
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
  })
  if (!session || (!workflowsDir && !subagentsDir && !tasksDir)) {
    return undefined
  }
  const now = Date.now()
  const running = runningTaskAges({
    agents: subagentsDir ? readAgentRecords(subagentsDir) : [],
    bashTasks: tasksDir ? readBashTaskRecords(tasksDir) : [],
    now,
    workflows: workflowsDir ? readWorkflowRecords(workflowsDir) : [],
  })

  const storeDir = resolveSeenStoreDir(
    process.env['CLAUDE_PROJECT_DIR'] || undefined,
  )
  const storeFile = path.join(storeDir, `${session}.json`)
  const store = readSeenStore(storeFile)
  const warned = tasksToWarn(running, store.seen)
  if (warned.length === 0) {
    return undefined
  }

  writeSeenStore(storeFile, {
    seen: mergeSeen(store.seen, warned),
    updatedAt: now,
  })
  sweepStaleSeenStores(storeDir, { now, ttlMs: SEEN_STORE_TTL_MS })
  return notify(formatLongrunNudge(warned))
}

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
