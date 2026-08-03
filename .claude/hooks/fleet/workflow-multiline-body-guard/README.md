# workflow-multiline-body-guard

PreToolUse Edit/Write hook that blocks introducing a multi-line
`gh ... --body "..."` into a workflow YAML file.

## Why

Multi-line markdown inside `--body "..."` in a workflow `run:` block
breaks YAML parsing. The failure is silent: GitHub shows "0 jobs" on
push triggers, no error in the UI. Historical incident: a fleet workflow
was broken for 3 weeks because someone added a markdown PR body inline.

Symptoms:

- Push doesn't trigger anything.
- `gh run list` shows no recent runs.
- The YAML file _looks_ fine in an editor.
- Actionlint catches it — but only if it's wired in.

## What it blocks

| Pattern                                                | Block? |
| ------------------------------------------------------ | ------ |
| `gh pr create --body "single line"`                    | no     |
| `gh pr create --body "$BODY"`                          | no     |
| `gh pr create --body-file /tmp/body.md`                | no     |
| `gh pr create --body "## Heading\n- bullet"` (literal) | yes    |
| Same pattern with `gh issue create` / `gh release ...` | yes    |
| Same pattern outside `.github/workflows/*.y*ml`        | no     |

## Bypass

Type the canonical phrase in a new message:

    Allow workflow-yaml-multiline-body bypass

Use sparingly — the failure mode is hard to debug.

## Detection

Regex over the after-edit text: find `--body "` openers, walk to the
matching close quote (respecting backslash escapes), check whether the
captured body contains a newline. Skip when the body is a single
variable expansion (`"$VAR"` / `"${VAR}"`).
