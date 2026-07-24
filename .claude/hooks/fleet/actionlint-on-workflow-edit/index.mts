#!/usr/bin/env node
// Claude Code PostToolUse hook — actionlint-on-workflow-edit.
//
// After an Edit/Write touches `.github/workflows/*.y*ml`, invoke local
// `actionlint` AND `zizmor` (if installed) against the file. Surface
// findings as stderr so the agent sees them before the next turn.
//
// Two scanners, independent:
//   - actionlint catches YAML / shell / SHA-pin issues that GitHub's
//     parser would silently reject as "0 jobs"
//   - zizmor catches security-sensitive patterns: pull_request_target
//     misuse, untrusted-input-in-script, secret leaks, privilege
//     escalation — supply-chain risks actionlint doesn't model
//
// PostToolUse (not PreToolUse) so the edit lands first and the scanners
// read on-disk state. No block — reporting only (a nudge). The block
// surface is covered by sibling hooks (`workflow-uses-comment-guard`,
// `workflow-multiline-body-guard`, `pull-request-target-guard`).
//
// No-op for either scanner when it isn't on PATH — most fleet machines
// have both via brew or setup-security-tools, CI runners have them
// preinstalled, but downstreams may not.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

export function actionlintAvailable(): boolean {
  const r = spawnSync('command', ['-v', 'actionlint'], {
    timeout: spawnTimeoutMs(2000),
  })
  return r.status === 0 && String(r.stdout ?? '').trim().length > 0
}

export function zizmorAvailable(): boolean {
  const r = spawnSync('command', ['-v', 'zizmor'], {
    timeout: spawnTimeoutMs(2000),
  })
  return r.status === 0 && String(r.stdout ?? '').trim().length > 0
}

export function isWorkflowYaml(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(
    normalizePath(filePath),
  )
}

// PostToolUse — reporting only, never blocks (a nudge). Runs both scanners
// (independent; both can flag the same file) and returns their combined output.
export const check = editGuard(filePath => {
  if (!isWorkflowYaml(filePath)) {
    return undefined
  }
  const reports: string[] = []

  // actionlint — YAML / shell / SHA-pin issues.
  if (actionlintAvailable()) {
    const r = spawnSync('actionlint', [filePath], {
      timeout: spawnTimeoutMs(10_000),
    })
    if (r.status !== 0) {
      reports.push(
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
        timeout: spawnTimeoutMs(15_000),
      },
    )
    // zizmor exits non-zero when findings exist. Surface the output
    // regardless so even informational findings are visible.
    if (r.status !== 0) {
      reports.push(
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

  return reports.length ? notify(reports.join('\n')) : undefined
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'Write'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
