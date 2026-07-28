#!/usr/bin/env node
// Claude Code PreToolUse hook — skill-usage-logger.
//
// Appends one tab-separated line per Skill tool invocation to
// `~/.claude/projects/<project>/.skill-usage.log`. The log is read
// by `scripts/audit-skill-usage.mts` to surface skill-reuse patterns.
//
// Format: `<ISO-timestamp>\t<skill-name>\t<cwd>\n`
//
// The hook is read-only telemetry. Every failure path falls open
// (no log write, silent allow) so a broken log directory or unparseable
// payload never costs the user a Skill call.
//
// Disable for one session: set `SOCKET_SKILL_USAGE_LOG=` (empty).

import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { defineHook, runHook } from '../_shared/guard.mts'

// Resolve the per-project log path. Caller may override via env. The
// canonical path lives next to Claude Code's per-project state at
// `~/.claude/projects/<sanitized-cwd>/.skill-usage.log`. The transcript
// path the hook receives already names the right project directory —
// reuse its parent.
export function resolveLogPath(
  envOverride: string | undefined,
  transcriptPath: string | undefined,
  homeDir: string,
): string | undefined {
  // Env-override wins. Empty string explicitly disables.
  if (envOverride !== undefined) {
    return envOverride === '' ? undefined : envOverride
  }
  if (transcriptPath) {
    // Transcript path looks like:
    //   ~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl
    // The log lives next to it, one level up from the .jsonl.
    return path.join(path.dirname(transcriptPath), '.skill-usage.log')
  }
  // Fall back to a single global log if no transcript path is in
  // the payload — audit script still finds it via glob.
  if (!homeDir) {
    return undefined
  }
  return path.join(homeDir, '.claude', 'projects', '.skill-usage.log')
}

export function buildLine(
  timestamp: string,
  skillName: string,
  cwd: string,
): string {
  // Replace embedded tabs/newlines so they can't desync the format.
  // Skill names are kebab-case in fleet practice; replacement is
  // defensive.
  const safeSkill = skillName.replace(/[\t\n\r]/g, '_')
  const safeCwd = cwd.replace(/[\t\n\r]/g, '_')
  return `${timestamp}\t${safeSkill}\t${safeCwd}\n`
}

export const hook = defineHook({
  check: payload => {
    if (payload.tool_name !== 'Skill') {
      return undefined
    }
    const skillName = payload.tool_input?.skill
    if (!skillName || typeof skillName !== 'string') {
      return undefined
    }
    const logPath = resolveLogPath(
      process.env['SOCKET_SKILL_USAGE_LOG'],
      payload.transcript_path,
      os.homedir(),
    )
    if (!logPath) {
      return undefined
    }
    const dir = path.dirname(logPath)
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    } catch {
      // Unwritable log dir — fall open (no telemetry, never a blocked call).
      return undefined
    }
    // Cap the log at 1 MB. The audit script reads the full file; an
    // unbounded log would surprise the runner. At ~80 bytes per line,
    // 1 MB ≈ 13k invocations — months of normal usage.
    try {
      if (existsSync(logPath)) {
        const stats = statSync(logPath)
        if (stats.size > 1024 * 1024) {
          return undefined
        }
      }
    } catch {
      // Stat failure is fine — caller can still append.
    }
    const timestamp = new Date().toISOString()
    // process.cwd() is unstable for a hook subprocess — anchor on the
    // agent-provided project-root env var instead, falling back to the
    // home dir so the log line never records an empty column.
    const cwd = process.env['CLAUDE_PROJECT_DIR'] || os.homedir()
    const line = buildLine(timestamp, skillName, cwd)
    try {
      appendFileSync(logPath, line)
    } catch {
      // Disk full / permissions / read-only fs — fall open.
    }
    return undefined
  },
  event: 'PreToolUse',
  matcher: ['Skill'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
