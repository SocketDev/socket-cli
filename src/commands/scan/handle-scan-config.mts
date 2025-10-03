/** @fileoverview Scan configuration handler for Socket CLI. Orchestrates interactive scan config setup and delegates to output formatter for confirmation display. */

import { outputScanConfigResult } from './output-scan-config-result.mts'
import { setupScanConfig } from './setup-scan-config.mts'

export async function handleScanConfig(
  cwd: string,
  defaultOnReadError = false,
) {
  const result = await setupScanConfig(cwd, defaultOnReadError)

  await outputScanConfigResult(result)
}
