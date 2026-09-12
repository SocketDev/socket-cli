import { outputScanConfigResult } from './output-scan-config-result.mts'
import { setupScanConfig } from './setup-scan-config.mts'

export async function handleScanConfig(
  cwd: string,
  defaultOnReadError = false,
) {
  const result = await setupScanConfig(cwd, defaultOnReadError)

  await outputScanConfigResult(result)
}
