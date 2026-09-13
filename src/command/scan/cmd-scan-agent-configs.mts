import { createScannerPatternCommand } from './cmd-scan-patterns.mts'

export const cmdScanAgentConfigs = createScannerPatternCommand(
  'agent-configs',
  'agentConfigs',
  'Inspect agent configuration security rules',
)
