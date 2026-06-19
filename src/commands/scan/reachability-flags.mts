import constants from '../../constants.mts'

import type { MeowFlags } from '../../flags.mts'

export const reachabilityFlags: MeowFlags = {
  reachVersion: {
    type: 'string',
    description: `Override the version of @coana-tech/cli used for reachability analysis. Default: ${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}.`,
  },
  reachAnalysisMemoryLimit: {
    type: 'string',
    default: '8192',
    description:
      'The maximum memory for the reachability analysis as a whole number optionally followed by MB or GB (e.g. 512MB, 8GB). The default is 8GB.',
  },
  reachAnalysisTimeout: {
    type: 'string',
    default: '',
    description:
      'Set the timeout for the reachability analysis as a whole number optionally followed by s, m or h (e.g. 90s, 10m, 1h). Defaults to 10m. Split analysis runs may cause the total scan time to exceed this timeout significantly.',
  },
  reachConcurrency: {
    type: 'number',
    default: 1,
    description:
      'Set the maximum number of concurrent reachability analysis runs. It is recommended to choose a concurrency level that ensures each analysis run has at least the --reach-analysis-memory-limit amount of memory available.',
  },
  reachContinueOnAnalysisErrors: {
    type: 'boolean',
    default: false,
    description:
      'Continue reachability analysis when errors occur (timeouts, OOM, parse errors, etc.), falling back to precomputed (Tier 2) results. By default, the CLI halts on analysis errors.',
  },
  reachContinueOnInstallErrors: {
    type: 'boolean',
    default: false,
    description:
      'Continue reachability analysis when package installation fails, falling back to precomputed (Tier 2) results. By default, the CLI halts on installation errors.',
  },
  reachContinueOnMissingLockFiles: {
    type: 'boolean',
    default: false,
    description:
      'Continue reachability analysis when a Gradle or SBT project is missing its lock file (or version catalog / pre-generated SBOM). By default, the CLI halts.',
  },
  reachContinueOnNoSourceFiles: {
    type: 'boolean',
    default: false,
    description:
      'Continue reachability analysis when a workspace contains no source files for its ecosystem. By default, the CLI halts.',
  },
  reachDisableExternalToolChecks: {
    type: 'boolean',
    default: false,
    description: 'Disable external tool checks during reachability analysis.',
  },
  reachDebug: {
    type: 'boolean',
    default: false,
    description:
      'Enable debug mode for reachability analysis. Provides verbose logging from the reachability CLI.',
  },
  reachDetailedAnalysisLogFile: {
    type: 'boolean',
    default: false,
    description:
      'A log file with detailed analysis logs is written to root of each analyzed workspace.',
  },
  reachDisableAnalytics: {
    type: 'boolean',
    default: false,
    description:
      'Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.',
  },
  reachDisableAnalysisSplitting: {
    type: 'boolean',
    default: false,
    hidden: true,
    description:
      'Deprecated: Analysis splitting is now disabled by default. This flag is a no-op.',
  },
  reachEnableAnalysisSplitting: {
    type: 'boolean',
    default: false,
    description:
      'Allow the reachability analysis to partition CVEs into buckets that are processed in separate analysis runs. May improve accuracy, but not recommended by default.',
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
    hidden: true,
    description:
      'Deprecated: use --exclude-paths instead. List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.',
  },
  reachLazyMode: {
    type: 'boolean',
    default: false,
    description: 'Enable lazy mode for reachability analysis.',
    hidden: true,
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
}

export const excludePathsFlag: MeowFlags = {
  excludePaths: {
    type: 'string',
    isMultiple: true,
    description:
      'List of glob patterns to exclude from the scan, including SCA/SBOM manifest discovery and (when --reach is enabled) Tier 1 reachability analysis. Patterns are anchored micromatch globs matched relative to the Socket scan root, which is the command working directory (`--cwd` if set), not the reachability target: `tests` matches only `<cwd>/tests`; use `**/tests` to match at any depth. Negation patterns (`!path`) are not supported. Accepts a comma-separated value or multiple flags.',
  },
}
