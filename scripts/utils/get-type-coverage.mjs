/** @fileoverview Utility to calculate TypeScript type coverage percentage. */
import { spawn } from 'node:child_process'

/**
 * Execute type-coverage command and extract percentage from output.
 * @throws {Error} When type coverage command fails.
 */
export async function getTypeCoverage() {
  const result = await new Promise((resolve) => {
    let stdout = ''
    const child = spawn('pnpm', ['run', 'coverage:type'], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    })

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.on('exit', (code) => {
      resolve({ code: code || 0, stdout })
    })

    child.on('error', () => {
      resolve({ code: 1, stdout: '' })
    })
  })

  if (result.code !== 0) {
    throw new Error(`Failed to get type coverage: exit code ${result.code}`)
  }

  const output = result.stdout || ''
  const lines = output.split('\n')
  const percentageLine = lines.find(line => line.includes('%'))

  if (percentageLine) {
    const match = percentageLine.match(/(\d+(?:\.\d+)?)%/)
    if (match) {
      return Number.parseFloat(match[1])
    }
  }

  return null
}
