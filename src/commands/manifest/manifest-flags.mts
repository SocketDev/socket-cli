import type { MeowFlags } from '../../flags.mts'

// A manifest-scoped variant of `../scan/reachability-flags.mts`'s
// `excludePathsFlag`: these commands only ever generate a manifest/facts
// file, so the description must not reference "the scan" or reachability
// analysis, which don't apply when a manifest command is run standalone.
export const excludePathsFlag: MeowFlags = {
  excludePaths: {
    type: 'string',
    isMultiple: true,
    description:
      'List of glob patterns to exclude from manifest/facts generation. Patterns are anchored micromatch globs matched relative to CWD (`--cwd` if set): `tests` matches only `<cwd>/tests`; use `**/tests` to match at any depth. Negation patterns (`!path`) are not supported. Accepts a comma-separated value or multiple flags.',
  },
}
