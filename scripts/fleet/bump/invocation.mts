/*
 * @file The bump CLI preamble: the accepted flag set, the usage text, and the
 *   pure argv-to-decision resolver.
 *
 *   Kept apart from the step itself because this script WRITES — version,
 *   CHANGELOG, and a commit — and argv parsing is NON-STRICT. Both arms here
 *   exist because both have bitten: `--help` once fell through to a real bump,
 *   and a typo'd `--dryrun` parses as an unknown flag rather than throwing.
 *
 *   Split out of bump.mts, which was past the 1000-line hard cap.
 */

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'

// Every flag `main` accepts. Kept beside the parseArgs options it mirrors so a
// new flag is added in both places, and `unrecognizedFlags` can refuse the rest.
export const BUMP_FLAGS: ReadonlySet<string> = new Set([
  'dry-run',
  'empty-changelog-entry',
  'help',
  'release-as',
  'write-only',
])

export const BUMP_USAGE = `Usage: node scripts/fleet/bump.mts [options]

  Derives the next version from the Conventional Commits since the last
  release, writes package.json + CHANGELOG.md, and commits the bump.

  --dry-run                    preview; writes nothing
  --release-as <level|X.Y.Z>   major | minor | patch, or an exact version
  --write-only                 write the files but do NOT git-commit (CI)
  --empty-changelog-entry <s>  entry to use when no user-visible changes derive
  --help                       print this and exit

  The VERSION is the user's decision. Prefer naming the target as a
  \`X.Y.Z-prerelease\` hint in package.json — the release tooling consumes it.

  A package that has never shipped and still carries its placeholder version
  (\`0.0.0\`, or a \`X.Y.Z-prerelease\`) defaults to 0.1.0 — not a
  commit-derived bump, not 1.0.0. \`--release-as\` overrides it.`

/**
 * The `--flag` tokens in `argv` that `known` does not contain, normalized off
 * their leading dashes and any `=value` tail. A bare `-` or `--` is ignored,
 * and everything after a `--` separator is treated as positional.
 */
export function unrecognizedFlags(
  argv: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const unknown: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const token = argv[i]!
    if (token === '--') {
      break
    }
    if (!token.startsWith('--') || token.length <= 2) {
      continue
    }
    const name = token.slice(2).split('=')[0]!
    if (name && !known.has(name)) {
      unknown.push(`--${name}`)
    }
  }
  return unknown
}

/**
 * What the CLI preamble decided: print usage, refuse, or proceed with the
 * resolved flags. Pure — no argv globals, no writes — so every arm is
 * assertable without running a bump.
 */
export type BumpInvocation =
  | { kind: 'usage' }
  | { kind: 'refuse'; unknownFlags: readonly string[] }
  | {
      kind: 'run'
      dryRun: boolean
      emptyChangelogEntry: string | undefined
      releaseAs: string | undefined
      writeOnly: boolean
    }

/**
 * Resolve the bump CLI's argv into a decision.
 *
 * Two arms exist because this script WRITES — version, CHANGELOG, and a
 * commit. `--help` must never mutate: parsing is non-strict, so before this was
 * separated a `--help` run fell through to a REAL bump. And an unrecognized
 * flag is refused rather than ignored, because non-strict parsing turns a
 * typo'd `--dryrun` into a live release.
 */
export function resolveBumpInvocation(argv: readonly string[]): BumpInvocation {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'dry-run': { default: false, type: 'boolean' },
      'release-as': { type: 'string' },
      'write-only': { default: false, type: 'boolean' },
      'empty-changelog-entry': { type: 'string' },
      help: { default: false, type: 'boolean' },
    },
    strict: false,
  })
  if (values['help']) {
    return { kind: 'usage' }
  }
  const unknownFlags = unrecognizedFlags(argv, BUMP_FLAGS)
  if (unknownFlags.length) {
    return { kind: 'refuse', unknownFlags }
  }
  return {
    kind: 'run',
    dryRun: !!values['dry-run'],
    emptyChangelogEntry: values['empty-changelog-entry'] as string | undefined,
    releaseAs: values['release-as'] as string | undefined,
    writeOnly: !!values['write-only'],
  }
}

/**
 * The refusal text for an unrecognized flag. Separated from the decision so the
 * wording can change without touching the branch logic.
 */
export function unrecognizedFlagsMessage(
  unknownFlags: readonly string[],
): string {
  return (
    `bump: unrecognized flag(s) ${unknownFlags.join(', ')}.\n` +
    `  What:  this script WRITES (version + CHANGELOG + commit), so an\n` +
    `         unrecognized flag is refused rather than ignored — a typo'd\n` +
    `         --dry-run would otherwise perform a real bump.\n` +
    `  Where: the bump CLI.\n` +
    `  Saw:   ${unknownFlags.join(', ')}; wanted one of: ${[...BUMP_FLAGS].toSorted().join(', ')}.\n` +
    `  Fix:   correct the flag, or run --help for the full list.`
  )
}
