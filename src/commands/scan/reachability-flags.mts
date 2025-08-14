import type { MeowFlags } from '../../flags.mts'

export const reachabilityFlags: MeowFlags = {
  reachDisableAnalytics: {
    type: 'boolean',
    description:
      'Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.',
  },
  reachAnalysisMemoryLimit: {
    type: 'number',
    description:
      'The maximum memory in MB to use for the reachability analysis. The default is 8192MB.',
    default: 8192,
  },
  reachAnalysisTimeout: {
    type: 'number',
    description:
      'Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.',
  },
  reachEcosystems: {
    type: 'string',
    isMultiple: true,
    description:
      'List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.',
  },
  reachContinueOnFailingProjects: {
    type: 'boolean',
    description:
      'Continue reachability analysis even when some projects/workspaces fail. Default is to crash the CLI at the first failing project/workspace.',
  },
  reachExcludePaths: {
    type: 'string',
    isMultiple: true,
    description:
      'List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.',
  },
}
