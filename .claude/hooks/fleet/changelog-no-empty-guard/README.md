# changelog-no-empty-guard

PreToolUse hook on `Edit` / `Write` against `CHANGELOG.md`. Blocks the operation if the post-edit content would leave a Keep-a-Changelog section (`### Added`, `### Changed`, `### Deprecated`, `### Fixed`, `### Migration`, `### Performance`, `### Removed`, `### Renamed`, `### Security`) with zero bullets before the next heading.

## Why

The `docs/claude.md/fleet/version-bumps.md` §2 rule (CHANGELOG public-facing only) tells the author to filter internal commits out. When the filter happens to leave a section empty, the heading should be deleted too. Leaving an empty heading makes the reader disambiguate "section intentionally empty" from "section forgot its content."

## What counts as empty

The hook walks the post-edit content line by line. A `### <SectionName>` heading is flagged when its next non-blank line is either:

- Another `### ` heading
- A `## [` version heading
- End of file

Blank lines between the heading and the next heading don't count — only "no actual bullets in the section."

## Bypass

Type `Allow changelog-empty-section bypass` verbatim in a recent user message. The hook scans the last 8 user turns of the transcript.

Bypass is for rare cases where the author deliberately wants an empty heading (e.g. cherry-picking a release skeleton). Default policy is to delete the heading.

## What it does NOT do

- It does not check for sections OUTSIDE the Keep-a-Changelog schema (custom `### Internal` etc.).
- It does not enforce ordering of sections within a release.
- It does not enforce that the section bullets are well-formed (no `- ` prefix check).

## Tests

`pnpm exec node --test test/*.test.mts`
