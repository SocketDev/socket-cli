# copy-on-select-hint-nudge

**Type:** SessionStart hook (NUDGE — informational, never blocks).

## Trigger

Fires once at session start when **both** are true:

1. `~/.claude.json` has `copyOnSelect: false` (the fleet hardening from
   `scripts/fleet/setup/claude-config.mts`), and
2. `TERM_PROGRAM` is a mouse-reporting terminal (`iTerm.app`, `Apple_Terminal`,
   `WezTerm`, `ghostty`, `vscode`).

When the combo holds it prints, as SessionStart `additionalContext`, the
hold-Option-to-select workaround for copying text by mouse. Otherwise silent.

## Why

`copyOnSelect: false` stops the TUI auto-copying mouse selections (no OSC-52,
no iTerm2 clipboard banner). But under mouse reporting the TUI captures drag
events, so plain drag-select neither reaches the terminal nor gets auto-copied.
The fix is to hold **Option (⌥ / alt)** while dragging: the terminal then
handles the drag as a native selection instead of forwarding it to the app.
Because the bypass holds for the whole gesture, you can also re-drag (still
holding Option) to adjust or replace text that the app already has selected.
Then Cmd-C or right-click → Copy. This hook surfaces that once so the change in
copy behavior isn't a silent surprise.

True runtime mouse-reporting state is invisible to a hook (the TUI toggles it
via escape sequences, stored nowhere); the hook keys off the static
config + terminal combo that reliably produces the surprise.

## Bypass

None — it only prints informational text and cannot block or mutate anything.
To stop the hint, re-enable copy-on-select (`copyOnSelect: true`), which also
removes it from the fleet `HARDENED_GLOBAL_CONFIG`.
