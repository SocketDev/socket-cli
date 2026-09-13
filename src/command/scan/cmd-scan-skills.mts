import { createScannerPatternCommand } from './cmd-scan-patterns.mts'

export const cmdScanSkills = createScannerPatternCommand(
  'skills',
  'skills',
  'Scan agent skills for unsafe instructions',
)
