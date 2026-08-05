# outbound-voice-nudge

PreToolUse, non-blocking. Reads prose on its way OUT of the session and names
off-voice phrasing before it reaches a human.

## What it catches

The catalog is `_shared/outbound-voice.mts` — one source for every outbound
surface, the same single-catalog discipline `_shared/ai-attribution.mts` settled
on.

| Kind          | Terms                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `banned-word` | `pinned`, `seam`/`seams`                                                                           |
| `ai-tell`     | "in today's fast-paced", "it's important to note", "rest assured", "I hope this helps"              |

Both banned words are anchored to the exact token. `pinned` leaves "unpinned",
"pinning", and "pin" alone; `seam`/`seams` leaves "seamless" and "seamstress"
alone. Negative tests pin that, because a warn-only nudge that cries wolf on
ordinary technical prose is a nudge people learn to ignore.

## Surfaces

| Surface                    | Voice catalog | Shared slop set                             |
| -------------------------- | ------------- | ------------------------------------------- |
| `gh` (Bash)                | yes           | no — `convo-prose-nudge` already reports it  |
| Linear / Notion / Slack MCP | yes           | yes — nothing else watches these            |

The `gh` half reads bodies, titles, reviews, release notes, `gh api` fields, and
`--body-file` payloads by reusing the extractors that already exist:
`extractProse` from `no-github-ai-attribution-guard` and `extractBodyArg` from
`convo-prose-nudge`. Nothing about `gh` argument shapes is restated here.

The MCP half matches WRITE tools only, on a substring of the tool name
(`linear…__save_`, `notion__notion-create|update-`, `slack__slack_send|…`) — the
server segment varies per install, and a read tool's `query: "pinned"` is a
search term, not outbound prose. Within a matched call it collects strings under
prose-named keys (`body`, `description`, `text`, `content`, …) at any depth, so
Notion's `pages[].content` is covered without pinning one server's schema.

## Why a separate catalog from `ai-slop-patterns.mts`

That module gates `anti-prose-guard`, which BLOCKS writes to CHANGELOG / docs /
README, so it admits only near-zero-false-positive tells. `pinned` is what the
fleet's own SHA-pinning documentation calls the thing — banning it at a write
gate would block correct docs. These are a VOICE preference on OUTBOUND prose,
enforced warn-only, so they carry their own catalog and their own consumers.

## Two tiers of wiring

- **Repo**: `matcher: ['Bash', 'mcp__.*']`. The `settings.json` feed gate is the
  `.*` catch-all, so MCP tool calls already reach the dispatcher; the dispatch
  manifest routes them here.
- **Machine**: `global: true`, so `scripts/repo/setup/user-global-settings.mts`
  wires it into `~/.claude/settings.json` and it fires from EVERY repo session,
  not just fleet-managed ones. `scripts/repo/check/user-global-settings-are-current.mts`
  is the drift alarm. `scope` is deliberately omitted — the owner's voice is not
  a fleet-repo convention that stands down in a foreign repo.

## Never blocks

Voice is a judgment call. A false positive must cost a glance, not a retry, so
this is a `-nudge`: stderr and exit 0, always. Parse failures and unreadable
`--body-file` paths fail open the same way.
