import { readFile } from 'node:fs/promises'
import { spawnNativePackageProcess } from '../../../../../scripts/repo/build/sea/package/process.mts'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'

async function processIsRunning(pid: number): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
      return state !== 'Z'
    } catch {
      return false
    }
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!(await processIsRunning(pid))) {
      return
    }
    await setTimeout(25)
  }
  process.kill(pid, 'SIGKILL')
  throw new Error('Timed-out process tree remained alive.')
}

describe('native package process tree termination', () => {
  it.each([
    { name: 'timeout', outputLimit: false },
    { name: 'output cap', outputLimit: true },
  ])(
    'terminates a child and its pipe-holding grandchild on $name',
    async scenario => {
      const grandchildSource = 'setInterval(() => {}, 1000)'
      const output = scenario.outputLimit
        ? "process.stdout.write('x'.repeat(2048));"
        : ''
      const childSource = [
        "const { spawn } = require('node:child_process')",
        `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: ['ignore', 'inherit', 'inherit'] })`,
        "process.stdout.write(String(grandchild.pid) + '\\n')",
        output,
        'setInterval(() => {}, 1000)',
      ].join(';')
      const result = await spawnNativePackageProcess(
        process.execPath,
        ['-e', childSource],
        {
          cwd: process.cwd(),
          timeoutMs: 500,
          maxOutputBytes: 256,
        },
      )
      const pid = Number(result.stdout.toString().split('\n')[0])
      expect(Number.isInteger(pid)).toBe(true)
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('Grandchild process id was not captured.')
      }
      expect(result.timedOut).toBe(!scenario.outputLimit)
      expect(result.outputLimitExceeded).toBe(scenario.outputLimit)
      await waitForProcessExit(pid)
    },
  )
})
