/**
 * Validation helpers for `socket scan create`.
 *
 * Extracted from cmd-scan-create.mts to keep that file under the
 * 1000-line File-size hard cap. These helpers detect common
 * mistakes around the `--default-branch` / `--make-default-branch`
 * flag pair, where the legacy flag was a *boolean* but users often
 * tried to pass a value (e.g. `--default-branch=main` or
 * `--default-branch main`). The handler emits a friendly error
 * pointing at the right flag (`--branch <name>`) when one of these
 * misuses is detected.
 */

const LEGACY_DEFAULT_BRANCH_FLAGS = ['--default-branch', '--defaultBranch']
const LEGACY_DEFAULT_BRANCH_PREFIXES = LEGACY_DEFAULT_BRANCH_FLAGS.map(
  f => `${f}=`,
)
const DEFAULT_BRANCH_FLAGS = [
  '--make-default-branch',
  '--makeDefaultBranch',
  ...LEGACY_DEFAULT_BRANCH_FLAGS,
]
const DEFAULT_BRANCH_PREFIXES = DEFAULT_BRANCH_FLAGS.map(f => `${f}=`)

export function hasLegacyDefaultBranchFlag(argv: readonly string[]): boolean {
  return argv.some(
    arg =>
      LEGACY_DEFAULT_BRANCH_FLAGS.includes(arg) ||
      LEGACY_DEFAULT_BRANCH_PREFIXES.some(p => arg.startsWith(p)),
  )
}

export function isBareIdentifier(token: string): boolean {
  // Accept only tokens that look like a plain branch name. Anything
  // with a path separator, dot, or colon is almost certainly a target
  // path, URL, or something else the user meant as a positional arg.
  return /^[A-Za-z0-9_-]+$/.test(token)
}

export function findDefaultBranchValueMisuse(
  argv: readonly string[],
): { form: string; value: string } | undefined {
  // `--default-branch=main` — unambiguous: the `=` form attaches a
  // value to what meow treats as a boolean flag, so the value is
  // silently dropped.
  for (const arg of argv) {
    const prefix = DEFAULT_BRANCH_PREFIXES.find(p => arg.startsWith(p))
    if (!prefix) {
      continue
    }
    const value = arg.slice(prefix.length)
    const normalized = value.toLowerCase()
    if (normalized === 'true' || normalized === 'false' || value === '') {
      continue
    }
    return { form: `${prefix}${value}`, value }
  }
  // `--default-branch main` — ambiguous in general (the next token
  // could be a positional target path), but if the next token is a
  // bare identifier (no `/`, `.`, `:`) AND the user didn't also pass
  // `--branch` / `-b`, it's almost certainly a mis-typed branch name.
  const hasBranchFlag = argv.some(
    arg =>
      arg === '--branch' ||
      arg === '-b' ||
      arg.startsWith('--branch=') ||
      arg.startsWith('-b='),
  )
  if (hasBranchFlag) {
    return undefined
  }
  for (let i = 0; i < argv.length - 1; i += 1) {
    const arg = argv[i]!
    if (!DEFAULT_BRANCH_FLAGS.includes(arg)) {
      continue
    }
    const next = argv[i + 1]!
    if (next.startsWith('-') || !isBareIdentifier(next)) {
      continue
    }
    return { form: `${arg} ${next}`, value: next }
  }
  return undefined
}
