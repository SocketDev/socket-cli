# commit-author-guard

PreToolUse hook that blocks `git commit` invocations where the effective author email doesn't match the user's canonical GitHub identity.

## Why

The assistant sometimes commits as the wrong identity — for example signing as `jdalton@socket.dev` (a work email) when the user's canonical GitHub identity is `john.david.dalton@gmail.com`. The wrong identity:

- Misattributes commits in `git log` / GitHub history
- Breaks DCO / signed-commit verification if the wrong GPG key signs
- Mixes personal and work identities in a single repo's history

This hook catches the failure before the commit lands.

## What it catches

Three failure modes:

1. **`--author=` override**:
   ```
   git commit --author="Wrong <wrong@example.com>" -m "..."
   ```

2. **`-c user.email=` override**:
   ```
   git commit -c user.email=wrong@example.com -m "..."
   ```

3. **Wrong local checkout config**: the assistant edited `.git/config` to point at a different identity, then issues a plain `git commit` that inherits the wrong defaults.

## Canonical identity sources

In order of preference:

### `~/.claude/git-authors.json`

Explicit allowlist, the source of truth when present:

```json
{
  "canonical": {
    "name": "jdalton",
    "email": "john.david.dalton@gmail.com"
  },
  "aliases": [
    { "name": "jdalton", "email": "jdalton@socket.dev" }
  ]
}
```

The `canonical` identity is the default. `aliases` are additional emails accepted as legitimate (e.g., when work email is intentional in socket-internal repos).

### `git config --global user.email`

Fallback when the JSON config is absent. Reads the user's real identity from their global gitconfig.

## What it does NOT catch

- Environment-variable overrides (`GIT_AUTHOR_EMAIL=...`) — those are runtime state, not visible to a static command check. The hook can only see the command text.
- Commits already in the history — only catches new ones.

## Bypass

For legitimate cases where a different identity is needed (e.g., committing to a third-party repo where the work email is correct):

- Add the email to `aliases[]` in `~/.claude/git-authors.json` (persistent), or
- Type `Allow commit-author bypass` (or `Allow commit author bypass` / `Allow commitauthor bypass`) in a recent user message (one-shot), or
- Set `SOCKET_COMMIT_AUTHOR_GUARD_DISABLED=1` to turn off entirely.

## Test

```sh
pnpm test
```
