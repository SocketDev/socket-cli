# handoff-command-nudge

Stop-event nudge (never blocks). When an assistant reply hands a command to the
user to run — "go ahead and run it", "fire the release workflow", "you can
dispatch the publish" — but includes no literal, copy-pasteable command, it
reminds the assistant to give the exact line in a fenced code block.

Scans the last assistant turn's RAW text (fences intact — the fenced command is
the signal it checks for), unlike `reply-prose-nudge`, which strips fences
before scanning. Fires only when a handoff phrase is present AND no command
signal (fenced block, inline `code` span, or a `$ ` / tool-invocation line) is.

Codifies the "never just say 'do it' — give the exact command" directive.
