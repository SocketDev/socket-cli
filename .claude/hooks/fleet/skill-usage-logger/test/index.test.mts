// node --test specs for the skill-usage-logger hook.

// prefer-async-spawn: streaming-stdio-required.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpLogPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skill-usage-test-'))
  return path.join(dir, '.skill-usage.log')
}

async function runHook(
  payload: Record<string, unknown>,
  envOverride: Record<string, string | undefined> = {},
): Promise<Result> {
  const env = {
    ...process.env,
    ...envOverride,
  } as Record<string, string>
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe', env })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Skill tool: no log write, exit 0', async () => {
  const logPath = tmpLogPath()
  const r = await runHook(
    {
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  assert.strictEqual(r.code, 0)
  // File should not exist (nothing was written).
  let exists = true
  try {
    readFileSync(logPath, 'utf8')
  } catch {
    exists = false
  }
  assert.strictEqual(exists, false)
})

test('Skill tool: appends one line, exit 0', async () => {
  const logPath = tmpLogPath()
  const r = await runHook(
    {
      tool_name: 'Skill',
      tool_input: { skill: 'cascading-fleet' },
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  assert.strictEqual(r.code, 0)
  const content = readFileSync(logPath, 'utf8')
  // ISO-timestamp \t skill-name \t cwd \n
  assert.match(
    content,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\tcascading-fleet\t[^\n]+\n$/,
  )
})

test('two Skill calls: appends two lines', async () => {
  const logPath = tmpLogPath()
  await runHook(
    {
      tool_name: 'Skill',
      tool_input: { skill: 'prose' },
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  await runHook(
    {
      tool_name: 'Skill',
      tool_input: { skill: 'cascading-fleet' },
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  const content = readFileSync(logPath, 'utf8')
  const lines = content.trim().split('\n')
  assert.strictEqual(lines.length, 2)
  assert.match(lines[0]!, /\tprose\t/)
  assert.match(lines[1]!, /\tcascading-fleet\t/)
})

test('SOCKET_SKILL_USAGE_LOG empty: disables logging', async () => {
  const logPath = tmpLogPath()
  // First write a marker line to ensure we'd notice an overwrite.
  writeFileSync(logPath, 'marker\n')
  const r = await runHook(
    {
      tool_name: 'Skill',
      tool_input: { skill: 'should-not-log' },
    },
    { SOCKET_SKILL_USAGE_LOG: '' },
  )
  assert.strictEqual(r.code, 0)
  assert.strictEqual(readFileSync(logPath, 'utf8'), 'marker\n')
})

test('Skill without skill arg: no log write, exit 0', async () => {
  const logPath = tmpLogPath()
  const r = await runHook(
    {
      tool_name: 'Skill',
      tool_input: {},
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  assert.strictEqual(r.code, 0)
  let exists = true
  try {
    readFileSync(logPath, 'utf8')
  } catch {
    exists = false
  }
  assert.strictEqual(exists, false)
})

test('malformed JSON payload: fail open, exit 0', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('this is not json')
  await new Promise<void>(resolve => {
    child.process.on('exit', code => {
      assert.strictEqual(code, 0)
      resolve()
    })
  })
})

test('skill name with embedded tab: sanitized', async () => {
  const logPath = tmpLogPath()
  await runHook(
    {
      tool_name: 'Skill',
      tool_input: { skill: 'bad\tname\nwith\rcontrol' },
    },
    { SOCKET_SKILL_USAGE_LOG: logPath },
  )
  const content = readFileSync(logPath, 'utf8')
  // The skill column should not contain raw tabs/newlines.
  const lines = content.split('\n').filter(l => l.length > 0)
  assert.strictEqual(lines.length, 1)
  const cols = lines[0]!.split('\t')
  // ISO-timestamp, skill, cwd → 3 columns.
  assert.strictEqual(cols.length, 3)
  assert.strictEqual(cols[1], 'bad_name_with_control')
})
