import { createScannerPatternCommand } from './cmd-scan-patterns.mts'

export const cmdScanWorkflows = createScannerPatternCommand(
  'workflows',
  'workflows',
  'Inspect GitHub Actions workflow security rules',
)
