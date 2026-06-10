// node --test specs for the stale-node-modules-reminder PostToolUse hook.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectDangle,
  extractOutput,
  formatReminder,
  isNoTtyPurgeAbort,
  isWorkspaceResolutionBreak,
  offendingPackage,
} from '../index.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  code: number
  stderr: string
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  return new Promise(resolve => {
    const childPromise = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    let stderr = ''
    childPromise.process.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    childPromise.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
    childPromise.stdin?.end(JSON.stringify(payload))
  })
}

const DANGLE_OUTPUT = [
  'node:internal/modules/package_json_reader:301',
  '  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);',
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@socketsecurity/lib-stable' imported from /repo/.git-hooks/fleet/pre-commit.mts",
  '    at packageResolve (node:internal/modules/esm/resolve:768:81)',
].join('\n')

const PURGE_ABORT_OUTPUT = [
  ' WARN  Unsupported engine',
  'Scope: all 312 workspace projects',
  ' ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY  Aborted removal of modules directory due to no TTY',
].join('\n')

test('unit: detects a workspace-package resolution break', () => {
  assert.equal(isWorkspaceResolutionBreak(DANGLE_OUTPUT), true)
  assert.equal(
    offendingPackage(DANGLE_OUTPUT),
    '@socketsecurity/lib-stable',
  )
})

test('unit: ignores ERR without a scoped package', () => {
  assert.equal(
    isWorkspaceResolutionBreak('ERR_MODULE_NOT_FOUND: ./typo.mts'),
    false,
  )
})

test('unit: ignores a clean run', () => {
  assert.equal(isWorkspaceResolutionBreak('Done in 244ms'), false)
})

test('unit: detects the no-TTY modules-purge abort', () => {
  assert.equal(isNoTtyPurgeAbort(PURGE_ABORT_OUTPUT), true)
  assert.equal(isNoTtyPurgeAbort(DANGLE_OUTPUT), false)
})

test('unit: detectDangle classifies both faces', () => {
  assert.equal(detectDangle(DANGLE_OUTPUT), 'resolution')
  assert.equal(detectDangle(PURGE_ABORT_OUTPUT), 'purge-abort')
  assert.equal(detectDangle('Done in 244ms'), undefined)
})

test('unit: detectDangle prefers purge-abort when both appear', () => {
  // A relink attempt that printed the resolution error AND then tripped the
  // TTY prompt — the actionable signal is the abort.
  const both = `${DANGLE_OUTPUT}\n${PURGE_ABORT_OUTPUT}`
  assert.equal(detectDangle(both), 'purge-abort')
})

test('unit: extractOutput walks stdout + stderr', () => {
  assert.match(
    extractOutput({ stdout: 'a', stderr: 'b' }),
    /a\nb/,
  )
})

test('unit: resolution reminder names the package + headless-safe fix', () => {
  const msg = formatReminder('resolution', '@socketsecurity/lib-stable')
  assert.match(msg, /@socketsecurity\/lib-stable/)
  assert.match(msg, /pnpm install --config\.confirmModulesPurge=false/)
})

test('unit: purge-abort reminder explains the TTY trap + headless-safe fix', () => {
  const msg = formatReminder('purge-abort', undefined)
  assert.match(msg, /ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY/)
  assert.match(msg, /pnpm install --config\.confirmModulesPurge=false/)
})

test('fires on a Bash dangle failure', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -o foo' },
    tool_response: { stdout: '', stderr: DANGLE_OUTPUT },
  })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /stale-node-modules-reminder/)
  assert.match(r.stderr, /pnpm install --config\.confirmModulesPurge=false/)
})

test('fires on a no-TTY modules-purge abort', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm install' },
    tool_response: { stdout: '', stderr: PURGE_ABORT_OUTPUT },
  })
  assert.equal(r.code, 0)
  assert.match(r.stderr, /stale-node-modules-reminder/)
  assert.match(r.stderr, /ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY/)
  assert.match(r.stderr, /pnpm install --config\.confirmModulesPurge=false/)
})

test('non-Bash tool passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_response: DANGLE_OUTPUT,
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('clean Bash output passes silently', async () => {
  const r = await runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm install' },
    tool_response: { stdout: 'Already up to date', stderr: '' },
  })
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})
