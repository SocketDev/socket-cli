# no-screenshot-guard

`PreToolUse(Bash)` blocker that refuses screen capture. A screenshot is an
exfiltration surface: it can capture any window on the user's display (a
password manager, a 2FA code, another app) and write it to a file the agent
then reads. Fleet tooling never screenshots the live desktop — the visual-verify
flow renders a *known* page or extension popup to PNG via the
`rendering-chromium-to-png` skill (headless Chromium), which captures no desktop
state.

## Detected

| Platform | Binaries                                                            |
| -------- | ------------------------------------------------------------------- |
| macOS    | `screencapture`                                                     |
| Linux    | `scrot`, `grim`, `import`, `maim`, `gnome-screenshot`, `spectacle`, `flameshot` |
| Windows  | `snippingtool`, `SnippingTool.exe`                                  |

Detection is AST-parsed via the fleet shell parser (`findInvocation`), not a
loose regex, so a path fragment or quoted literal doesn't false-fire.

## Bypass

Type the canonical phrase verbatim in your next user turn:

```
Allow screenshot bypass
```

Use when the user has asked for a screenshot of their screen.

## Why

An agent that can run `screencapture` reads whatever is on screen at that
moment, beyond its own output. The default-deny posture means a capture happens
after the user authorizes it via the bypass phrase, the same way
`no-clipboard-access-guard` gates the clipboard.
