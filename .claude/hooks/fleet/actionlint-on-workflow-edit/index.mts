#!/usr/bin/env node
// Claude Code PostToolUse hook — actionlint-on-workflow-edit.
//
// After an Edit/Write touches `.github/workflows/*.y*ml`, invoke local
// `actionlint` AND `zizmor` (if installed) against the file. Surface
// findings as stderr so Claude sees them before the next turn.
//
// Two scanners, independent:
//   - actionlint catches YAML / shell / SHA-pin issues that GitHub's
//     parser would silently reject as "0 jobs"
//   - zizmor catches security-sensitive patterns: pull_request_target
//     misuse, untrusted-input-in-script, secret leaks, privilege
//     escalation — supply-chain risks actionlint doesn't model
//
// PostToolUse (not PreToolUse) so the edit lands first and the scanners
// read on-disk state. No block — reporting only. The block surface is
// covered by sibling hooks (`workflow-uses-comment-guard`,
// `workflow-yaml-multiline-body-guard`, `pull-request-target-guard`).
//
// No-op for either scanner when it isn't on PATH — most fleet machines
// have both via brew or setup-security-tools, CI runners have them
// preinstalled, but downstreams may not.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

export function actionlintAvailable(): boolean {
  const r = spawnSync('command', ['-v', 'actionlint'], {
    timeout: 2_000,
  })
  return r.status === 0 && String(r.stdout ?? '').trim().length > 0
}

export function zizmorAvailable(): boolean {
  const r = spawnSync('command', ['-v', 'zizmor'], {
    timeout: 2_000,
  })
  return r.status === 0 && String(r.stdout ?? '').trim().length > 0
}

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly file_path?: string | undefined } | undefined
}

export function isWorkflowYaml(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(filePath)
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

  // actionlint — YAML / shell / SHA-pin issues.
  if (actionlintAvailable()) {
    const r = spawnSync('actionlint', [filePath], { timeout: 10_000 })
    if (r.status !== 0) {
      process.stderr.write(
        [
          '[actionlint-on-workflow-edit] actionlint reported errors',
          '',
          `  File: ${filePath}`,
          '',
          '  Output:',
          ...String(r.stdout ?? '')
            .trim()
            .split('\n')
            .map((l: string) => `    ${l}`),
          ...(r.stderr
            ? String(r.stderr)
                .trim()
                .split('\n')
                .map((l: string) => `    ${l}`)
            : []),
          '',
          '  Fix the workflow before relying on it firing in CI. actionlint',
          "  catches the same YAML / shell / SHA-pin issues GitHub Actions'",
          '  parser would (silently) reject as "0 jobs."',
          '',
        ].join('\n'),
      )
    }
  }

  // zizmor — security-focused workflow auditor. Catches privilege
  // escalation, secret injection, untrusted-input-in-script patterns,
  // and pull_request_target misuse — the supply-chain threats that
  // actionlint doesn't model. Independent scan; both can flag the
  // same file.
  if (zizmorAvailable()) {
    const r = spawnSync(
      'zizmor',
      ['--no-progress', '--format', 'plain', filePath],
      {
        timeout: 15_000,
      },
    )
    // zizmor exits non-zero when findings exist. Surface the output
    // regardless so even informational findings are visible.
    if (r.status !== 0) {
      process.stderr.write(
        [
          '[actionlint-on-workflow-edit] zizmor reported findings',
          '',
          `  File: ${filePath}`,
          '',
          '  Output:',
          ...String(r.stdout ?? '')
            .trim()
            .split('\n')
            .map((l: string) => `    ${l}`),
          ...(r.stderr
            ? String(r.stderr)
                .trim()
                .split('\n')
                .map((l: string) => `    ${l}`)
            : []),
          '',
          '  zizmor scans for security-sensitive workflow patterns:',
          '  pull_request_target misuse, untrusted-input-in-script,',
          '  secret leaks, privilege escalation. Address findings',
          '  before merging.',
          '',
        ].join('\n'),
      )
    }
  }

  // PostToolUse — emit warnings to stderr but don't block the edit
  // (the edit already happened). Exit 0 so Claude sees the stderr.
  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[actionlint-on-workflow-edit] hook error (allowing): ${(e as Error).message}\n`,
  )
})
