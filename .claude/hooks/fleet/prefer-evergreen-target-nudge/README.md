# prefer-evergreen-target-nudge

Claude Code **Stop** hook (nudge — never blocks, always exits 0).

## Why

The fleet default is evergreen / latest-and-greatest. For an auto-updating
runtime (a Chrome extension, the web, a CI-pinned Node) a back-versioned
`tsconfig` `target`/`lib` leaves modern syntax downleveled or untyped for no
benefit. JSON config (tsconfig, package.json, browserslist) is not lintable by
oxlint, so this Stop nudge is the only enforcement surface for the principle.
See `docs/agents.md/fleet/drift-watch.md` ("Evergreen / latest-and-greatest
targets").

## Trigger

Scans the last assistant turn's text and code fences for an `ES<year>` token
(`"target": "ES2017"`, a `"lib"` entry, …) below the current year floor inside
a tsconfig-shaped block, and writes a stderr nudge pointing at `ESNext`. A
plain `ESNext` or an at/above-floor year produces no nudge.

## Bypass

Type `Allow evergreen-target bypass` verbatim in a recent message.
