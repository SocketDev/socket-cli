// Orchestrator barrel for git-hook shared helpers. Runs the Node-version gate
// at module load, then re-exports the focused leaf modules that carry the
// actual logic: the scanning kernel (scan-core), the secret / convention /
// comment / commit-message / supply-chain scanners, file + git IO, and the
// staged-state gates. Each hook imports `getDefaultLogger` from
// `@socketsecurity/lib-stable/logger/default` directly for output; this module
// stays import-light so the cost of `import '../_shared/helpers.mts'` is bounded.
//
// Requires Node 24+ for default-on native .mts type-stripping (no flag needed).
//
// Hooks run *after* `pnpm install`, so `@socketsecurity/lib-stable` is on the
// resolution path for any caller that imports it.

// Canonical path normalization, re-exported so git-hooks share the one
// implementation (backslash → slash, slash-collapse, `.`/`..` resolution, UNC /
// namespace preservation) instead of a naive local `.replace`. Staged file lists
// and `git rev-parse --show-toplevel` can carry Windows backslashes; downstream
// `startsWith('.git-hooks/')` / `includes('/external/')` matching assumes
// forward slashes.
export { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Personal-path matcher lives in the gate-free _shared/personal-path.mts so the
// edit-time personal-path-guard shares THIS code (single source for both hook
// trees). Re-exported here for the commit-time consumers' existing surface.
export {
  isPurePlaceholder,
  PERSONAL_PATH_RE,
  suggestPlaceholder,
} from './personal-path.mts'

// Scanning kernel: line-splitting, marker/doc-context detection, LineHit shape.
export {
  aliasMatches,
  isInsideBackticks,
  lineIsSuppressed,
  looksLikeDocumentation,
  socketLintMarkerFor,
  splitLines,
  stripTemplateLayer,
} from './scan-core.mts'
export type { LineHit } from './scan-core.mts'

// Secret / credential + personal-path scanners and the API-key allowlist.
export {
  FAKE_TOKEN_LEGACY,
  FAKE_TOKEN_MARKER,
  filterAllowedApiKeys,
  scanAwsKeys,
  scanGitHubTokens,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  SOCKET_SECURITY_ENV,
  SOCKET_TOKEN_ENV_NAMES,
} from './scan-secrets.mts'

// Package-manager + dependency-doc convention scanners.
export {
  scanDocsPnpmFirst,
  scanNpxDlx,
  scanPackageJsonPnpmOverrides,
  suggestNpxReplacement,
} from './scan-package-conventions.mts'

// Source-code reference convention scanners (logger leaks + cross-repo paths).
export {
  scanCrossRepoPaths,
  scanLoggerLeaks,
  suggestLoggerReplacement,
} from './scan-code-refs.mts'

// PR-process / quest / step-N narrative comment scanner + comment extractor.
export { commentTextOf, scanPrProcessComments } from './scan-comments.mts'

// Commit-message content scrubbers/scanners.
export { scanLinearRefs, stripScanLabels } from './scan-commit-msg.mts'

// File classification + content reading.
export { readFileForScan, shouldSkipFile } from './file-scan.mts'

// Git subprocess wrappers.
export { git, gitLines, gitOrThrow } from './git.mts'

// Commit / push-time staged-state gates.
export {
  catastrophicDeletionFromCounts,
  catastrophicDeletionReason,
  checkOxlintRuleWiringStaged,
  mergeInProgress,
  runStagedTestsReminder,
  stagedIndexIsEmpty,
} from './staged-gates.mts'

// Supply-chain / lockdown push-time content scanners.
export {
  scanAiConfigPoison,
  scanProgrammaticClaudeLockdown,
  scanSoakExcludeDateAnnotations,
} from './scan-supply-chain.mts'

// AI attribution detector lives in the gate-free `ai-attribution.mts` so the
// Claude-side no-github-ai-attribution-guard can import it on the operator's
// Node (this barrel carries a Node-25 hard-exit gate). Re-export here so the
// commit-msg / pre-push consumers + their tests keep their existing surface.
export {
  AI_ATTRIBUTION_RE,
  containsAiAttribution,
  stripAiAttribution,
} from './ai-attribution.mts'

// External GitHub issue/PR reference scanner, re-exported from the gate-free
// _shared/external-issue-ref.mts (single definition). The Claude-side
// no-ext-issue-ref-guard imports that module directly because this barrel
// carries a Node-25 hard-exit a Claude hook on an older operator Node must not
// trip; the git-stage commit-msg backstop imports it from here.
export {
  ALLOWED_ISSUE_REF_ORGS,
  scanExternalIssueRefs,
} from './external-issue-ref.mts'
export type { ExternalIssueRef } from './external-issue-ref.mts'

// Hard-fail if Node is below 25. This runs at module load — every
// hook invocation imports _shared/helpers.mts before doing anything, so the
// version check is the first thing that happens.
const NODE_MIN_MAJOR = 24
const nodeMajor = Number.parseInt(
  process.versions.node.split('.')[0] || '0',
  10,
)
if (nodeMajor < NODE_MIN_MAJOR) {
  // This import-light shared helper does not own a logger. Use raw
  // process.stderr with ASCII (no
  // status-emoji glyph) so the no-status-emoji lint rule stays clean
  // — the lint rule's recommendation (use logger.fail()) doesn't
  // apply when the entire branch is the logger-unavailable bail.
  // oxlint-disable-next-line socket/no-module-eval-side-effects -- Node-floor bail before any import resolves; raw stderr is the only channel here.
  process.stderr.write(
    `\x1b[0;31mHook requires Node >= ${NODE_MIN_MAJOR}.0.0 (have v${process.versions.node})\x1b[0m\n`,
  )
  // oxlint-disable-next-line socket/no-module-eval-side-effects -- Node-floor bail before any import resolves; raw stderr is the only channel here.
  process.stderr.write(
    'Install Node 24+ — these hooks rely on default-on .mts type stripping.\n',
  )
  process.exit(1)
}
