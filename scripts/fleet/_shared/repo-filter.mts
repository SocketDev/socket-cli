/*
 * @file Narrow a fleet-wide sweep to named repos — the `--repo` flag shared by
 *   the settings laws.
 *
 *   Every settings law reads the whole roster and sweeps it. That is right for
 *   the weekly patrol and wrong for onboarding: applying a law with `--fix`
 *   while onboarding ONE new member would reach out and mutate GitHub settings
 *   on the other forty repos as a side effect of adding the forty-first. A
 *   selector keeps the blast radius equal to the intent.
 *
 *   THE VACUOUS-GREEN TRAP, AGAIN: a selector that matches nothing must be a
 *   hard error, never an empty sweep. `--repo cod-sign` (typo) would otherwise
 *   audit zero repos and report "OK — every audited main carries its required
 *   rules", a green that verified nothing. This is the same failure settings-
 *   audit.mts's canary read exists to prevent, arriving through a different
 *   door, so `selectRepos` reports unmatched selectors and every caller exits
 *   red on them.
 */

export interface NamedRepo {
  readonly name: string
  readonly owner: string
}

export interface RepoSelection<T> {
  /**
   * Roster entries the selectors matched, in roster order.
   */
  readonly selected: T[]
  /**
   * Selectors that matched no roster entry — always a hard error.
   */
  readonly unmatched: string[]
}

/**
 * Collect `--repo <value>` / `--repo=<value>` from argv. Repeatable, and each
 * value may be comma-separated, so all three of these select the same pair:
 *
 * --repo code-sign --repo sockeye
 * --repo=code-sign,sockeye
 * --repo SocketDev/code-sign --repo=sockeye.
 *
 * Pure; exported for tests.
 */
export function parseRepoFilter(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    let raw: string | undefined
    if (arg === '--repo') {
      raw = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--repo=')) {
      raw = arg.slice('--repo='.length)
    }
    if (raw === undefined) {
      continue
    }
    const parts = raw.split(',')
    for (let j = 0, partsLength = parts.length; j < partsLength; j += 1) {
      const part = parts[j]!.trim()
      // A bare `--repo` with no value, or `--repo --fix`, selects nothing
      // rather than swallowing the next flag as a repo name.
      if (part && !part.startsWith('-')) {
        out.push(part)
      }
    }
  }
  return out
}

/**
 * Does `selector` name this repo? Accepts the bare name (`code-sign`) or the
 * owner-qualified slug (`SocketDev/code-sign`). GitHub repo names are
 * case-insensitive, so the comparison is too — otherwise `--repo Code-Sign`
 * would land in the unmatched list and read as "not in the fleet".
 */
function matchesRepo(repo: NamedRepo, selector: string): boolean {
  const wanted = selector.toLowerCase()
  const name = repo.name.toLowerCase()
  return wanted === name || wanted === `${repo.owner.toLowerCase()}/${name}`
}

/**
 * Narrow `repos` to the entries named by `selectors`, preserving roster order
 * and reporting selectors that matched nothing.
 *
 * An empty selector list means "no filter": the full roster comes back, which
 * is what the unflagged weekly patrol wants. Pure; exported for tests.
 */
export function selectRepos<T extends NamedRepo>(
  repos: readonly T[],
  selectors: readonly string[],
): RepoSelection<T> {
  if (selectors.length === 0) {
    return { selected: [...repos], unmatched: [] }
  }
  const selected: T[] = []
  const matched = new Set<string>()
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    let hit = false
    // Every selector that names this repo is marked, not just the first.
    // Stopping at the first match would report `--repo code-sign --repo
    // SocketDev/code-sign` as having an unmatched selector — a hard error
    // raised against a selector that names a real member.
    for (
      let j = 0, selectorCount = selectors.length;
      j < selectorCount;
      j += 1
    ) {
      const selector = selectors[j]!
      if (matchesRepo(repo, selector)) {
        matched.add(selector)
        hit = true
      }
    }
    if (hit) {
      selected.push(repo)
    }
  }
  const unmatched: string[] = []
  for (let i = 0, { length } = selectors; i < length; i += 1) {
    const selector = selectors[i]!
    if (!matched.has(selector) && !unmatched.includes(selector)) {
      unmatched.push(selector)
    }
  }
  return { selected, unmatched }
}

/**
 * The message a law prints before exiting red on an unmatched selector. Names
 * the typo and where the roster lives, because the overwhelmingly common cause
 * is a misspelling or a member that was never registered. Pure.
 */
export function unmatchedSelectorMessage(
  law: string,
  unmatched: readonly string[],
): string {
  return (
    `${law}: --repo matched no roster entry: ${unmatched.join(', ')}. ` +
    'Sweeping zero repos would report a green that verified nothing, so this ' +
    'is an error. Check the spelling, or register the member first: ' +
    'node scripts/repo/register-fleet-member.mts --name <name>'
  )
}
