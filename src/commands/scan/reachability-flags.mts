import type { MeowFlags } from '../../flags.mts'

export const reachabilityFlags: MeowFlags = {
  reachAnalysisMemoryLimit: {
    type: 'number',
    default: 8192,
    description:
      'The maximum memory in MB to use for the reachability analysis. The default is 8192MB.',
  },
  reachAnalysisTimeout: {
    type: 'number',
    default: 0,
    description:
      'Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.',
  },
  reachDisableAnalytics: {
    type: 'boolean',
    default: false,
    description:
      'Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.',
  },
  reachEcosystems: {
    type: 'string',
    isMultiple: true,
    description:
      'List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.',
  },
  reachExcludePaths: {
    type: 'string',
    isMultiple: true,
    description:
      'List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.',
  },
  reachSkipCache: {
    type: 'boolean',
    default: false,
    description:
      'Skip caching-based optimizations. By default, the reachability analysis will use cached configurations from previous runs to speed up the analysis.',
  },
}
