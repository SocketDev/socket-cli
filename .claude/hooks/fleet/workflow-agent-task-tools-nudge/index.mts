#!/usr/bin/env node
// Claude Code PreToolUse hook — workflow-agent-task-tools-nudge.
//
// Fires (with a stderr reminder, not a block) when a `Workflow` tool call ships
// a script that references a session task tool — `TaskGet`, `TaskUpdate`,
// `TaskList`, `TaskCreate`, `TaskOutput`, `TaskStop`. Neither the workflow
// script body NOR its `agent()` subagents can reach those tools: the task store
// belongs to the main session harness, and a workflow subagent only gets the
// standard tools plus MCP via ToolSearch. A prompt telling an agent to
// "TaskGet your spec" sends it in blind — it guesses or burns a turn hunting a
// tool that isn't there. (2026-07-04 overnight run: 3 of 5 socket-lib workflow
// steps were skipped exactly this way.)
//
// The pattern: TaskGet the FULL description in the main loop, inline it verbatim
// into the agent prompt, have agents report via structured output (schema),
// and let the orchestrator do all TaskUpdate bookkeeping after the harvest.
//
// Detection: plain `.includes` (no-hook-cmd-regex-guard — the tool names carry
// no shell command) over the inline `script` and, best-effort, the file at
// `scriptPath`. Reminder-only (notify, exit 0): a descriptive comment about the
// orchestrator's own bookkeeping is a legitimate reason for the name to appear,
// so blocking would misfire.
//
// Detail: docs/agents.md/fleet/agent-delegation.md.

import { readFileSync } from 'node:fs'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// The session task tools, none of which a workflow reaches. Sorted (ASCII).
const TASK_TOOL_NAMES: readonly string[] = [
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
]

export function findTaskToolRef(script: string): string | undefined {
  for (let i = 0, { length } = TASK_TOOL_NAMES; i < length; i += 1) {
    const name = TASK_TOOL_NAMES[i]!
    if (script.includes(name)) {
      return name
    }
  }
  return undefined
}

// Resolve the workflow's script text from the tool input: the inline `script`
// plus, best-effort, the file named by `scriptPath` (a re-run of a persisted
// workflow). Never throws — an unreadable path just contributes no text.
export function resolveWorkflowScript(payload: ToolCallPayload): string {
  const input = payload.tool_input as
    | { script?: unknown | undefined; scriptPath?: unknown | undefined }
    | undefined
  let text = typeof input?.script === 'string' ? input.script : ''
  if (typeof input?.scriptPath === 'string' && input.scriptPath) {
    try {
      text += '\n' + readFileSync(input.scriptPath, 'utf8')
    } catch {
      // Unreadable path — scan only the inline script.
    }
  }
  return text
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'Workflow') {
    return undefined
  }
  const script = resolveWorkflowScript(payload)
  if (!script) {
    return undefined
  }
  const ref = findTaskToolRef(script)
  if (!ref) {
    return undefined
  }
  return notify(
    [
      '[workflow-agent-task-tools-nudge] Workflow script references a task tool.',
      '',
      `  Found: "${ref}" in the workflow script.`,
      '',
      '  A workflow script body AND its agent() subagents reach NO task tools',
      '  (TaskGet/TaskUpdate/TaskList/TaskCreate/TaskOutput/TaskStop). The task',
      '  store belongs to the main session — workflow agents get standard tools',
      '  + MCP only. An agent told to "TaskGet your spec" goes in blind.',
      '',
      '  The pattern that works:',
      '    - TaskGet the FULL spec in the main loop, inline it verbatim into',
      '      the agent() prompt (the agent has no other way to see it),',
      '    - agents report via structured output (schema:), not TaskUpdate,',
      '    - YOU (the orchestrator) do all TaskUpdate bookkeeping after harvest.',
      '',
      '  A descriptive comment about your own bookkeeping is fine — this is a',
      '  reminder, not a block. See agent-delegation.md.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Workflow'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
