import type { ReachabilityOptions } from '../src/commands/scan/perform-reachability-analysis.mts'

// Mirrors the CLI flag defaults, so a test spreads this and sets only what it
// exercises.
export function makeReachabilityOptions(): ReachabilityOptions {
  return {
    dynamicSbomInference: false,
    excludePaths: [],
    reachAdvisories: [],
    reachAnalysisMemoryLimit: '8192',
    reachAnalysisTimeout: '',
    reachConcurrency: 1,
    reachContinueOnAnalysisErrors: false,
    reachContinueOnInstallErrors: false,
    reachContinueOnMissingLockFiles: false,
    reachContinueOnNoSourceFiles: false,
    reachDebug: false,
    reachDetailedAnalysisLogFile: false,
    reachDisableAnalytics: false,
    reachDisableDependencyDownloads: false,
    reachDisableExternalToolChecks: false,
    reachEcosystems: [],
    reachEnableAnalysisSplitting: false,
    reachExcludePaths: [],
    reachRetainFactsFile: false,
    reachSkipCache: false,
    reachUseOnlyPregeneratedSboms: false,
    reachVersion: undefined,
  }
}
