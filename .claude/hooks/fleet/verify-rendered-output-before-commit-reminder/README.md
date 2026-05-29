# verify-rendered-output-before-commit-reminder

PreToolUse Bash hook (reminder, NOT a block) that fires on `git commit`
when:

1. Staged files include UI/render shapes (`*.html` / `*.css` / etc.).
2. The transcript shows a build invocation since the last user
   verification signal.
3. No user signal ("looks good" / "ship it" / "verified" / "push")
   has appeared since the build.

## Why

Past pattern: agents committed UI changes (CSS, HTML, build outputs)
before checking the rendered artifact. Wasted commits piled up per
session — the user paraphrase was "rebuild before you fucking commit."

This hook surfaces the reminder so the agent pauses to verify the
artifact before committing.

## What it covers

| Staged files        | Recent build? | User verify since build? | Reminder? |
| ------------------- | ------------- | ------------------------ | --------- |
| Pure source (`.ts`) | —             | —                        | no        |
| UI files (`.html`)  | no            | —                        | no        |
| UI files (`.html`)  | yes           | yes                      | no        |
| UI files (`.html`)  | yes           | no                       | yes       |

## User verify patterns

- "looks good", "ship it", "verified", "confirmed"
- "rebuild looks correct", "build is correct", "render looks right"
- "push" (terminal directive)

## Not a block

False-positive surface is real (sometimes the build output is
self-evident in the diff). The reminder lets the agent pause; the user
can also override by typing a verify signal before retrying.
