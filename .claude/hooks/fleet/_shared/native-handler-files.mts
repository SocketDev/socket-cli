/**
 * @file Files under `template/base` distributed by a per-file cascade handler
 *   rather than a manifest byte-list (content varies / is generated per repo):
 *   `.claude/settings.json` (settings-merge), `README.md` (readme-skeleton),
 *   the gh-aw `actions-lock.json` (`gh aw compile` companion). Shared by the
 *   `wheelhouse-drift-guard` hook and the classification belt scan
 *   `scripts/fleet/check/wheelhouse-controlled-files-are-classified.mts` so the
 *   write-time guard and the scan never disagree on the native-handler set (1
 *   list, 1 reference). Sorted.
 */

export const NATIVE_HANDLER_FILES: readonly string[] = [
  '.claude/settings.json',
  '.github/aw/actions-lock.json',
  'README.md',
]
