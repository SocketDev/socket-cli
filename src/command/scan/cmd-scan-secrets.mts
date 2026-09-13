import { createScannerPatternCommand } from './cmd-scan-patterns.mts'

export const cmdScanSecrets = createScannerPatternCommand(
  'secrets',
  'secrets',
  'Scan files for exposed secrets',
)
