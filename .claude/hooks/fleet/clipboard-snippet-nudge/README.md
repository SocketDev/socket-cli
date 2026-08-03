# clipboard-snippet-nudge

PostToolUse(Write) nudge. When a run/paste snippet — a script the **user** is
meant to run (`.sh` / `.bash` / `.zsh` / `.js` / `.mjs` / `.cjs` / `.mts` /
`.ts` / `.py`) — is written into the session scratchpad on macOS, it suggests:

> `pbcopy < <file>` puts it on the user's clipboard so they don't copy it out of
> the scrolling terminal.

- **Non-blocking.** Notify only; always exits 0. No bypass phrase.
- **macOS-only.** `pbcopy` is a macOS binary; the nudge is skipped elsewhere.
- **Scope.** Fires only for snippet files under a `/scratchpad/` dir or the
  per-session claude temp dir (`/tmp/claude-<uid>/…`), so an ordinary source
  edit never triggers it.
- **Clipboard writes, not reads.** Writing a snippet to the clipboard is the
  sanctioned pattern; clipboard/keychain **reads** stay banned (token-hygiene).

Detection lives in the exported, unit-tested `isScratchpadSnippet(filePath)`.
