// @hook-doc docs/fleet/agents.md/release-vs-cascade.md

import path from 'node:path'

import { isGeneratedAiAdapterPath } from '../../../../scripts/fleet/ai/adapters/paths.mts'
import { findGitRoot } from '../../../../scripts/fleet/fs/path-to-repo.mts'
import {
  collectCommandText,
  extractApplyPatchPaths,
} from '../../../../scripts/fleet/cross-cli/fleet-fork-detect.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readCommand, readFilePath } from '../_shared/payload.mts'
import { resolveProjectPath } from '../_shared/paths.mts'
import { normalizeShellDir, parseCommands } from '../_shared/shell-command.mts'
import { readGitAdapterCandidates } from './git.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import type { GuardResult } from '../_shared/guard.mts'

function adapterBlock(): GuardResult {
  return block(
    'ai-adapter-source-guard: Generated AI adapter output cannot be authored or committed. Edit the shared source, then run setup:mcp or gen:harness-adapters.',
  )
}

export function check(payload: ToolCallPayload): GuardResult {
  const cwd = resolveProjectPath(payload.cwd)
  const root = findGitRoot(cwd) ?? cwd
  if (['Edit', 'MultiEdit', 'Write'].includes(payload.tool_name ?? '')) {
    const file = readFilePath(payload)
    return file &&
      isGeneratedAiAdapterPath(path.relative(root, path.resolve(cwd, file)))
      ? adapterBlock()
      : undefined
  }
  if (payload.tool_name === 'apply_patch') {
    const patch = collectCommandText(payload.tool_input)
      .split(/\r?\n/)
      .filter(line => !line.startsWith('*** Delete File: '))
      .join('\n')
    return extractApplyPatchPaths(patch).some(file =>
      isGeneratedAiAdapterPath(path.relative(root, path.resolve(cwd, file))),
    )
      ? adapterBlock()
      : undefined
  }
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const text = readCommand(payload)
  if (!text) {
    return undefined
  }
  return checkGitCommands(text, cwd)
}

function checkGitCommands(text: string, cwd: string): GuardResult {
  for (const command of parseCommands(text)) {
    const binary = path.basename(command.binary)
    if (binary === 'cd' && command.args[0]) {
      cwd = normalizeShellDir(command.args[0], cwd)
      continue
    }
    if (binary !== 'git') {
      continue
    }
    const candidates = readGitAdapterCandidates(command, cwd)
    if (candidates === undefined) {
      return block(
        'ai-adapter-source-guard: Cannot verify the Git selection. Use noninteractive explicit paths and retry; generated adapters must remain untracked.',
      )
    }
    if (candidates.some(isGeneratedAiAdapterPath)) {
      return adapterBlock()
    }
  }
  return undefined
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'MultiEdit', 'Write', 'apply_patch'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
