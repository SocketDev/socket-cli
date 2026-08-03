/**
 * @file Canonical Homebrew tap SHA pins — the ONE source the pinned-bundle CI
 *   flow reads to check each tap out at a commit at least `SOAK_DAYS` old.
 *   Every version present at that SHA is definitionally soaked, so one pin per
 *   tap soaks every install from it. Owned by
 *   `scripts/fleet/update/brew.mts --apply` (regenerated whole; never
 *   hand-edit), gated offline by
 *   `scripts/fleet/check/brew-install-is-pinned.mts` (each pin >= SOAK_DAYS
 *   old + internally consistent). Advance: `node
 *   scripts/fleet/update/brew.mts --apply --soak-days N`.
 */

export interface BrewTapPin {
  // ISO-8601 committer date of `sha` (YYYY-MM-DDTHH:MM:SSZ) — the soak clock.
  readonly committedAt: string
  // The commit the tap is checked out at during a pinned install.
  readonly sha: string
  // The tap repo, `owner/repo` form.
  readonly tap: 'Homebrew/homebrew-cask' | 'Homebrew/homebrew-core'
}

export const BREW_TAP_PINS: readonly BrewTapPin[] = [
  {
    committedAt: '2026-07-04T14:05:05Z',
    sha: '32cd6abdfe310e3f175cfc874c0ca896501a88ac',
    tap: 'Homebrew/homebrew-cask',
  },
  {
    committedAt: '2026-07-04T15:19:32Z',
    sha: '3d4793778a988155da733404b33ba157f4d0c969',
    tap: 'Homebrew/homebrew-core',
  },
]
