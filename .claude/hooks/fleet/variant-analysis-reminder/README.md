# variant-analysis-reminder

Stop hook that flags High/Critical severity mentions in the assistant's most-recent turn that aren't followed by variant-search tool calls.

## Why

CLAUDE.md "Variant analysis on every High/Critical finding":

> When a finding lands at severity High or Critical, search the rest of the repo for the same shape before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file, sibling files, cross-package.

This hook catches the failure mode where the assistant identifies a High/Critical issue, fixes the one instance, and moves on — without checking whether the same shape exists elsewhere in the repo.

## What it catches

The hook scans the assistant's prose for severity labels in finding-shaped contexts:

- `Critical:` / `High:`
- `Severity: Critical` / `Severity: High`
- `● Critical` / `● High` (bullet-shaped findings)
- `CRITICAL(` / `HIGH(` / `CRITICAL:` / `HIGH:` (callout shape)

Code fences are stripped first so a quoted phrase doesn't false-positive (e.g., a code example mentioning a "High" enum value).

If a severity mention is found, the hook then inspects the same turn's tool-use events. If **at least one** Grep / Glob / Read / Agent call ran in the turn, the hook is satisfied — the assistant did some kind of search. If zero searches ran, the warning surfaces.

This is intentionally lenient: the hook can't tell whether the search was for variants of the right thing, so it only flags the case where no search at all happened. The user reads the warning and decides if the variant analysis was sufficient.

## Why it doesn't block

Stop hooks fire after the turn. Blocking would just truncate the findings. The warning prompts the next turn to do the search.

## Configuration

`SOCKET_VARIANT_ANALYSIS_REMINDER_DISABLED=1` — turn off entirely.

## Test

```sh
pnpm test
```
