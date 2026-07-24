// Personal-path leak matcher — shared by the commit-time scanPersonalPaths
// (.git-hooks/_shared/helpers.mts) and the edit-time personal-path-guard
// (.claude/hooks/fleet/). Both surfaces import THESE regexes + helpers so the
// two can't drift (they were previously lock-step inline copies). Gate-free
// (no Node-25 hard-exit like helpers.mts) so the Claude hook can import it on
// the operator's possibly-older Node.
//
// Flags a hardcoded USERNAME leak: /Users/<user>/, /home/<user>/,
// C:\Users\<USERNAME>\. Username-free forms (`~/`, `$HOME/`) are the OPPOSITE — the
// recommended shapes — and are NOT flagged. Pure-placeholder lines
// (/Users/<user>/, $USER) are documentation, not leaks.

// Real personal paths to flag. NFKC-normalize the line before matching (the
// caller does this) so full-width / ligature variants of `/Users` don't slip
// past the ASCII-only class.
export const PERSONAL_PATH_RE =
  /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|C:\\Users\\[^\\]+\\)/

// Placeholder forms we ALLOW (documentation, not leaks): `<...>` components and
// `$VAR` / `${VAR}` under the platform user dir. Canonical fleet style:
//   /Users/<user>/...   /home/<user>/...   C:\Users\<USERNAME>\...
export const PERSONAL_PATH_PLACEHOLDER_RE =
  /(?:\/Users\/<[^>]*>\/|\/home\/<[^>]*>\/|C:\\Users\\<[^>]*>\\|\/Users\/\$\{?[A-Z_]+\}?\/|\/home\/\$\{?[A-Z_]+\}?\/)/

// Well-known CI / system home dirs whose "username" is a service account, not a
// oxlint-disable-next-line socket/personal-path-placeholders -- `runner` is a known CI service account, not a personal leak.
// person — so `/home/runner/...` (GitHub Actions), `/home/ubuntu/...` etc. are
// oxlint-disable-next-line socket/personal-path-placeholders -- `runner` is a known CI service account, not a personal leak.
// not personal leaks. gh-aw's compiled `.lock.yml` emits `/home/runner/work/...`
// tool-cache mounts; those are correct, not a leak. Matched as the path's
// username segment only.
export const KNOWN_NON_PERSONAL_PATH_RE =
  /(?:\/Users\/(?:runner)\/|\/home\/(?:circleci|runner|ubuntu|vscode|vsts)\/)/

// True when a line is a PURE placeholder: it matches the placeholder shape AND
// nothing real remains after stripping every placeholder. Such lines are
// documentation, so the scanners skip them. A line whose only "personal" paths
// oxlint-disable-next-line socket/personal-path-placeholders -- `runner` is a known CI service account, not a personal leak.
// are well-known CI/system homes (e.g. /home/runner/) is also pure — those
// usernames are service accounts, not people.
export function isPurePlaceholder(line: string): boolean {
  const hasPlaceholder = PERSONAL_PATH_PLACEHOLDER_RE.test(line)
  const hasCiHome = KNOWN_NON_PERSONAL_PATH_RE.test(line)
  if (!hasPlaceholder && !hasCiHome) {
    return false
  }
  let stripped = line.replace(new RegExp(PERSONAL_PATH_PLACEHOLDER_RE, 'g'), '')
  stripped = stripped.replace(new RegExp(KNOWN_NON_PERSONAL_PATH_RE, 'g'), '')
  return !PERSONAL_PATH_RE.test(stripped)
}

// Rewrite the real personal paths on a line into the canonical placeholders, so
// both surfaces print the same fix recipe.
export function suggestPlaceholder(line: string): string {
  return line
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<user>/')
    .replace(/\/home\/[^/\s]+\//g, '/home/<user>/')
    .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\<USERNAME>\\')
}
