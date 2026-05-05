# auth-rotation-reminder

Claude Code `Stop` hook that periodically logs you out of authenticated
CLIs (npm, pnpm, gcloud, vault, aws sso, docker, socket, …) so stale
long-lived tokens don't sit in your dotfiles or keychain for days.

## Why

Long-lived auth tokens live in well-known locations: `~/.npmrc`,
`~/.config/gh/hosts.yml`, `~/.config/gcloud/`, `~/.docker/config.json`.
A compromised dev workstation has a wide blast radius on those files.
Periodic auto-revocation tightens the window and forces explicit
re-authentication, which is itself a small phishing-defense moment
("did I really mean to publish?").

## Defaults

- **Interval**: 1 hour. Set `SOCKET_AUTH_ROTATION_INTERVAL_HOURS=4` to
  loosen, `=0` to run on every Stop event.
- **Mode**: auto-logout (the hook *acts*, not just warns).
- **Default skip-list**: `gh` is skipped because Claude Code itself
  uses `gh` for `gh pr edit` etc. — auto-revoking it would break the
  agent.
- **CI**: hook short-circuits when `CI` env var is set.

## What's swept

| id        | display name      | detect            | logout                         |
| --------- | ----------------- | ----------------- | ------------------------------ |
| npm       | npm               | `npm whoami`      | `npm logout`                   |
| pnpm      | pnpm              | `pnpm whoami`     | `pnpm logout`                  |
| yarn      | yarn              | `yarn --version`  | `yarn npm logout`              |
| gcloud    | gcloud            | `gcloud auth list ... ACTIVE` | `gcloud auth revoke --all --quiet` |
| aws-sso   | aws (sso)         | `aws sts get-caller-identity` | `aws sso logout` |
| gh        | gh (GitHub CLI)   | `gh auth status`  | `gh auth logout --hostname github.com` |
| vault     | vault             | `vault token lookup` | `vault token revoke -self` |
| docker    | docker            | `docker info \| grep Username:` | `docker logout` |
| socket    | socket            | `socket whoami`   | `socket logout`                |

The hook never reads, prints, or compares any token value. Detection
is exit-code only; logout commands' output is suppressed except for
non-zero exit codes which surface as "logout failed" lines.

## Snoozing

Need to keep your auth alive for the next few hours (e.g. mid-publish)?
Drop a `.snooze` file with an ISO 8601 expiry on line 1.

```bash
# Snooze for 4 hours, project-local
date -ud "+4 hours" +"%Y-%m-%dT%H:%M:%SZ" > .claude/auth-rotation.snooze

# Snooze globally for 8 hours (applies to every repo)
mkdir -p ~/.claude/hooks/auth-rotation
date -ud "+8 hours" +"%Y-%m-%dT%H:%M:%SZ" > ~/.claude/hooks/auth-rotation/snooze
```

The hook **automatically deletes the file** once the timestamp is
reached. No manual cleanup needed.

Snoozes that are malformed, empty, or unreadable are also auto-deleted
on the next run — fail-safe so a corrupted file can't permanently
disable rotation.

`.claude/*.snooze` is gitignored; project-local snoozes never leak into
commits.

## Skip-list

Permanently skip a service:

```bash
# Per-user: applies to every repo
mkdir -p ~/.claude/hooks/auth-rotation
echo gcloud >> ~/.claude/hooks/auth-rotation/services-skip

# Per-repo: applies just to this checkout
echo vault >> .claude/auth-rotation.services-skip
```

One id per line. Lines starting with `#` are comments. Service ids
are stable — see the table above.

## Disable temporarily

```bash
SOCKET_AUTH_ROTATION_DISABLED=1   # any non-empty value
```

For pairing sessions, demos, etc. The hook short-circuits before
doing any work.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/auth-rotation-reminder/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Tests

```bash
cd .claude/hooks/auth-rotation-reminder
node --test test/*.test.mts
```

## Reusing the snooze convention

Other hooks can adopt the same `.snooze` pattern. The convention is:

- Filename: `.claude/<hook-id>.snooze` (project) or
  `~/.claude/hooks/<hook-id>/snooze` (global).
- Format: ISO 8601 expiry on line 1. Optional further lines ignored.
- `.gitignore`: `.claude/*.snooze`.
- Cleanup: hook auto-deletes expired files via `safeDelete`.
- The `checkSnoozes` / `tryUnlink` helpers in `index.mts` are easy to
  copy into a sibling hook.
