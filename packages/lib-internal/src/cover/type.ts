/**
 * @fileoverview TypeScript type coverage utilities.
 */

import { spawn } from '../spawn'

import type { GetTypeCoverageOptions, TypeCoverageResult } from './types'

/**
 * Get TypeScript type coverage metrics.
 *
 * @throws {Error} When type-coverage command fails (if generateIfMissing is false).
 */
export async function getTypeCoverage(
  options?: GetTypeCoverageOptions | undefined,
): Promise<TypeCoverageResult | null> {
  const opts = {
    __proto__: null,
    cwd: process.cwd(),
    generateIfMissing: false,
    ...options,
  } as GetTypeCoverageOptions

  const { cwd, generateIfMissing } = opts

  if (!cwd) {
    throw new Error('Working directory is required.')
  }

  try {
    // Run type-coverage to get metrics.
    const result = await spawn('type-coverage', ['--detail'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Parse output: "1234 / 5678 48.92%"
    const outputText = result.stdout ? result.stdout.toString() : ''
    const match = /(\d+) \/ (\d+) ([\d.]+)%/.exec(outputText)

    if (!match || !match[1] || !match[2] || !match[3]) {
      return null
    }

    return {
      covered: Number.parseInt(match[1], 10),
      percent: match[3],
      total: Number.parseInt(match[2], 10),
    }
  } catch (e) {
    if (generateIfMissing) {
      throw new Error(
        'Unable to generate type coverage. Ensure type-coverage is installed.',
        { cause: e },
      )
    }
    // If not generating, return null when type-coverage isn't available.
    return null
  }
}
