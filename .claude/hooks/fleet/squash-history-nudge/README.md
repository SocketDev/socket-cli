# squash-history-nudge

Stop hook that nudges the operator toward the `squashing-history` skill when an opted-in fleet repo's default branch has grown beyond a configurable commit threshold.

## Why

A subset of fleet repos (currently `socket-addon`, `socket-bin`, `socket-btm`, `sdxgen`, `stuie`) periodically squash the default branch to a single "Initial commit" — the convention exists for repos where deep history is more confusing than useful (binary publishing forwards, scratchpad tooling, etc.). The opt-in is declared centrally in `template/.claude/skills/cascading-fleet/lib/fleet-repos.json` under each repo's `optIns: ['squash-history']` array.

The hook is a soft reminder, not a blocker. It fires at end-of-turn when all three are true:

1. The current repo is on the opt-in list.
2. The current branch is the repo's default branch (`main` / `master` — resolved per the fleet's _Default branch fallback_ rule).
3. The default branch has > `SOCKET_SQUASH_HISTORY_COMMIT_THRESHOLD` commits (default 50).

When all three fire, stderr emits a one-paragraph reminder pointing at the `squashing-history` skill.

## Bypass

User types **`Allow squash-history-nudge bypass`** verbatim in a recent message (within the last 8 user turns). Case-sensitive; paraphrases don't count.

## Configuration

- `SOCKET_SQUASH_HISTORY_COMMIT_THRESHOLD` — integer; default 50. Below this count, the hook stays silent.

## Failing open

The hook fails open on its own bugs (the catch in `main()`). A buggy hook can never block the session.

## Related

- `.claude/skills/squashing-history/SKILL.md` — the canonical squash-history skill (does the actual work).
- `.claude/skills/cascading-fleet/lib/fleet-repos.json` — the roster + opt-in declarations.
- `.claude/hooks/fleet/default-branch-guard/` — sibling hook that enforces `main → master` fallback wherever the default branch is hard-coded.
