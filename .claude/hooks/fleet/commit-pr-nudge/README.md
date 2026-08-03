# commit-pr-nudge

Stop hook that flags assistant turns drafting commit messages or PR bodies missing fleet conventions.

## What it catches

- **AI attribution** — "Generated with Claude", "Co-Authored-By: Claude", `🤖 Generated`. The fleet's Commits & PRs rule forbids these.

The companion guards that actually block `git commit` / `gh pr create` invocations live separately. This hook only nudges when drafted text shows the antipatterns in the assistant turn.

## Bypass

No bypass — the reminder never blocks; it only nudges.

## Test

```sh
pnpm test
```
