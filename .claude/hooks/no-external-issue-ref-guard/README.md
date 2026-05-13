# no-external-issue-ref-guard

PreToolUse Bash hook. Blocks `git commit` / `gh pr create|edit|comment|review`
/ `gh issue create|edit|comment` / `gh release create|edit` invocations
whose message body contains a GitHub issue/PR reference to a non-SocketDev
repo.

## What it catches

The leak is GitHub's auto-link behavior: any `<owner>/<repo>#<num>` token
or `https://github.com/<owner>/<repo>/(issues|pull)/<num>` URL in a commit
message posts an `added N commits that reference this issue` event back to
the target issue. A fleet-wide cascade with one such ref in the message ends
up pinging the upstream maintainer N times.

## Allowed

- Bare `#123` — resolves against the current repo, no cross-repo leak.
- `SocketDev/<repo>#<num>` — same org, fine to ping (case-insensitive).
- `https://github.com/SocketDev/...` — same org.

## Blocked

- `spencermountain/compromise#1203` (or any other non-SocketDev `owner/repo#num`)
- `https://github.com/spencermountain/compromise/issues/1203`

## Bypass

`Allow external-issue-ref bypass` (verbatim, in a recent user turn).

## Fix path the hook suggests

- **Commit messages**: remove the ref. Move it to the PR description
  prose; PR bodies don't backref from commits.
- **PR/issue bodies**: rewrite to masked-link form, e.g.
  `[#1203](https://github.com/owner/repo/issues/1203)`. GitHub doesn't
  backref markdown links the same way.

## Cited from CLAUDE.md

Under *Public-surface hygiene*: "No external issue/PR refs in commit
messages or PR bodies" bullet.
