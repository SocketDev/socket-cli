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
  reachConcurrency: {
    type: 'number',
    default: 1,
    description:
      'Set the maximum number of concurrent reachability analysis runs. It is recommended to choose a concurrency level that ensures each analysis run has at least the --reach-analysis-memory-limit amount of memory available. NPM reachability analysis does not support concurrent execution, so the concurrency level is ignored for NPM.',
  },
  reachDisableExternalToolChecks: {
    type: 'boolean',
    default: false,
    description:
      'Disable external tool checks during reachability analysis.',
    hidden: true,
  },
  reachDebug: {
    type: 'boolean',
    default: false,
    description:
      'Enable debug mode for reachability analysis. Provides verbose logging from the reachability CLI.',
  },
  reachDisableAnalytics: {
    type: 'boolean',
    default: false,
    description:
      'Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.',
  },
  reachDetailedAnalysisLogFile: {
    type: 'boolean',
    default: false,
    description:
      'Write a detailed analysis log file alongside the output.',
    hidden: true,
  },
  reachDisableAnalysisSplitting: {
    type: 'boolean',
    default: false,
    description:
      'Deprecated: Analysis splitting is now disabled by default. Use --reach-enable-analysis-splitting to enable it.',
    hidden: true,
  },
  reachEnableAnalysisSplitting: {
    type: 'boolean',
    default: false,
    description:
      'Enable analysis splitting, allowing Coana to split reachability analysis into multiple runs per workspace.',
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
  reachLazyMode: {
    type: 'boolean',
    default: false,
    description: 'Enable lazy mode for reachability analysis.',
    hidden: true,
  },
  reachMinSeverity: {
    type: 'string',
    default: '',
    description:
      'Set the minimum severity of vulnerabilities to analyze. Supported severities are info, low, moderate, high and critical.',
  },
  reachSkipCache: {
    type: 'boolean',
    default: false,
    description:
      'Skip caching-based optimizations. By default, the reachability analysis will use cached configurations from previous runs to speed up the analysis.',
  },
  reachUseOnlyPregeneratedSboms: {
    type: 'boolean',
    default: false,
    description:
      'When using this option, the scan is created based only on pre-generated CDX and SPDX files in your project.',
  },
  reachUseUnreachableFromPrecomputation: {
    type: 'boolean',
    default: false,
    description:
      'Use unreachable information from precomputation to improve analysis accuracy.',
  },
  reachVersion: {
    type: 'string',
    default: '',
    description:
      'Override the default @coana-tech/cli version used for reachability analysis.',
    hidden: true,
  },
}
