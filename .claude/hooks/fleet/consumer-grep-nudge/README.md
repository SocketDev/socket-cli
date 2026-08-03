# consumer-grep-nudge

PreToolUse Edit hook (reminder, NOT a block) that fires when an edit
removes a CSS class, HTML attribute, or named export AND the repo has
consumer-bearing subtrees (`upstream/`, `additions/source-patched/`).

## Why

Past incident: an agent stripped a CSS class because repo-root grep
found 0 hits. The project's upstream bundle (in `upstream/`) hydrated
from that class — the rendered page went blank in production.

Repo-root grep doesn't see code in `upstream/` / `vendor/` / etc. when
those are gitignored or submodules. This hook surfaces the reminder to
grep those subtrees BEFORE relying on a "0 consumers" finding.

## What it surfaces

| Edit pattern                                             | Reminder? |
| -------------------------------------------------------- | --------- |
| Removes `.my-class-name` (hyphenated CSS class)          | yes       |
| Removes `data-foo` / `aria-bar` (HTML attribute literal) | yes       |
| Removes `export const foo` / `export function foo`       | yes       |
| Removes any of the above when NO consumer subtree exists | no        |
| Pure additions (no removals)                             | no        |
| Non-Edit tools                                           | no        |

## Not a block

False-positive surface is real — not every CSS class removal is a
hydration target. The reminder lets the agent verify with a grep
against the listed subtrees, then continue. The user can also ignore
the reminder if they've already verified.

## Suggested response

When this fires, run something like:

```bash
rg -nF '.removed-class' upstream/ additions/source-patched/
```

If the grep finds hits, the removal needs coordination with the
upstream bundle. If 0 hits, proceed.
