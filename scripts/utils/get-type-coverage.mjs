/** @fileoverview Type coverage percentage extraction from type-coverage tool output. */

import constants from '@socketsecurity/registry/lib/constants'
import { spawn } from '@socketsecurity/registry/lib/spawn'

/**
 * Execute type-coverage command and extract percentage from output.
 */
export async function getTypeCoverage() {
  // Run the type-coverage command and capture its output.
  const result = await spawn('pnpm', ['run', 'coverage:type'], {
    stdio: 'pipe',
    // Use shell on Windows for proper command execution.
    shell: constants.WIN32,
  })

  // Check if the command executed successfully.
  if (result.code !== 0) {
    throw new Error(`Failed to get type coverage: exit code ${result.code}`)
  }

  // Parse the output to find the line containing the percentage.
  const output = result.stdout || ''
  const lines = output.split('\n')
  const percentageLine = lines.find(line => line.includes('%'))

  // Extract the percentage value from the line using regex.
  if (percentageLine) {
    // Matches patterns like "95.12%" or "100%" and extracts the numeric part.
    const match = percentageLine.match(/(\d+(?:\.\d+)?)%/)
    if (match) {
      return parseFloat(match[1])
    }
  }

  // Return null if no percentage was found in the output.
  return null
}
