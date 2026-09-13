import { createScannerPatternCommand } from './cmd-scan-patterns.mts'

export const cmdScanManifests = createScannerPatternCommand(
  'manifests',
  'manifests',
  'Scan package manifests for exposed secrets',
)
