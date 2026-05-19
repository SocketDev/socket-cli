#!/usr/bin/env node
// Claude Code PostToolUse hook — actionlint-on-workflow-edit.
//
// After an Edit/Write touches `.github/workflows/*.y*ml`, invoke local
// `actionlint` (if installed) against the file. Surface any errors as
// stderr so Claude sees the problem before the next turn.
//
// PostToolUse (not PreToolUse) so the edit lands first and actionlint
// reads the on-disk state. No block — reporting only. The block surface
// is covered by sibling hooks (`workflow-uses-comment-guard`,
// `workflow-yaml-multiline-body-guard`, `pull-request-target-guard`).
//
// No-op when actionlint isn't on PATH — most fleet machines have it via
// brew, CI runners have it preinstalled, but downstreams may not.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly file_path?: string | undefined } | undefined
}

function isWorkflowYaml(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(filePath)
}

function actionlintAvailable(): boolean {
  const r = spawnSync('command', ['-v', 'actionlint'], {
    encoding: 'utf8',
    timeout: 2_000,
  })
  return r.status === 0 && (r.stdout?.trim().length ?? 0) > 0
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    process.exit(0)
  }
  const filePath = payload.tool_input?.file_path
  if (!filePath || !isWorkflowYaml(filePath)) {
    process.exit(0)
  }

  if (!actionlintAvailable()) {
    process.exit(0)
  }

  const r = spawnSync('actionlint', [filePath], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (r.status === 0) {
    process.exit(0)
  }

  // actionlint failed — surface its output to stderr so Claude reads it.
  process.stderr.write(
    [
      '[actionlint-on-workflow-edit] actionlint reported errors',
      '',
      `  File: ${filePath}`,
      '',
      '  Output:',
      ...(r.stdout ?? '')
        .trim()
        .split('\n')
        .map(l => `    ${l}`),
      ...(r.stderr
        ? r.stderr
            .trim()
            .split('\n')
            .map(l => `    ${l}`)
        : []),
      '',
      '  Fix the workflow before relying on it firing in CI. actionlint',
      "  catches the same YAML / shell / SHA-pin issues GitHub Actions'",
      '  parser would (silently) reject as "0 jobs."',
      '',
    ].join('\n'),
  )
  // PostToolUse — emit warning to stderr but don't block the edit
  // (the edit already happened). Exit 0 so Claude sees the stderr.
  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[actionlint-on-workflow-edit] hook error (allowing): ${(e as Error).message}\n`,
  )
})
