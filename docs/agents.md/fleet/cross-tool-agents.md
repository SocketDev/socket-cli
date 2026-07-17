# Cross-tool agents: instructions, skills, memory, detection

The fleet's automation is authored for **Claude Code**, but Codex, OpenCode,
and Kimi Code CLI read some of the same surfaces. This doc records what ports
across tools, what doesn't, and the code that makes the fleet agent- +
platform-aware.

## The surfaces, by portability

| Surface                    | Claude Code                         | Codex CLI                     | OpenCode                                          | Kimi Code CLI                          | Ports?                                               |
| -------------------------- | ----------------------------------- | ----------------------------- | ------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| **Instructions**           | `CLAUDE.md`                         | `AGENTS.md`                   | `AGENTS.md`                                       | none (user config only)                | yes for Codex/OpenCode via `AGENTS.md → CLAUDE.md`   |
| **Skills**                 | `.claude/skills/<name>/SKILL.md`    | `.agents/skills/` (one level) | `.claude/skills/` + `.agents/skills/` (one level) | none                                   | yes for Codex/OpenCode via `.agents/skills/` mirror  |
| **Commands**               | `.claude/commands/`                 | Codex slash-commands          | OpenCode commands                                 | none                                   | no (per-tool format)                                 |
| **Hooks**                  | `.claude/hooks/` (stdin JSON)       | Codex Hooks                   | OpenCode plugins (event callbacks)                | none                                   | no (per-tool mechanism)                              |
| **MCP servers**            | `.mcp.json`                         | `.codex/config.toml`          | `opencode.json`                                   | `.kimi-code/mcp.json`                  | yes, generated from `.mcp.json`                      |
| **Permissions**            | `.claude/settings.json`             | Codex config                  | OpenCode config                                   | `~/.kimi-code/config.toml`             | no (per-tool config)                                 |
| **Memory** (agent-written) | `~/.claude/projects/<slug>/memory/` | none                          | none                                              | none                                   | n/a (only Claude has it)                             |

## Instructions — `AGENTS.md → CLAUDE.md`

`AGENTS.md` is the tool-agnostic instructions file Codex + OpenCode read natively.
CLAUDE.md stays the **real, primary** file (the cascade composite-injects the
fleet block, and hundreds of references key off its path). `AGENTS.md` is a
**relative same-dir symlink → CLAUDE.md**, so all three tools read one source.

- Resolves to the repo's own CLAUDE.md on macOS/Linux.
- On stock Windows (no Developer-Mode/admin symlink privilege), git checks it out
  as a small file literally containing the text `CLAUDE.md`: a findable
  breadcrumb, not the content. Accepted, because fleet devs are on macOS/Linux
  and the symlink is the intended fleet pattern. Passes
  `tracked-symlinks-are-safe` (relative, same-dir, not
  self-referential/absolute/node_modules).

## Skills — the `.agents/skills/` flat mirror

Codex + OpenCode discover skills **one level deep** (`<root>/<name>/SKILL.md`), so
the fleet's segmented `.claude/skills/{fleet,repo}/<name>/` is invisible to them.
`gen-agents-skills-mirror.mts` generates a flat mirror at
`.agents/skills/<tier>-<name>/` (e.g. `fleet-codifying-disciplines`) with the
frontmatter `name:` rewritten to match the dir. OpenCode validates name === dir,
so the mirror is a generated COPY rather than a symlink. Claude keeps reading
`.claude/skills/`; Codex + OpenCode read the mirror. The mirror is generated and
git-untracked: the cascade regenerates it (`sync-scaffolding/fix-agents-mirror.mts`)
and the `agents-skills-mirror-nudge` hook flags a hand-edited skill source, so
no `check --all` gate verifies it.

**Tool-restriction caveat:** Claude's per-skill `allowed-tools` does not port.
Codex/OpenCode gate tools at the agent/config level, not per-skill, so a mirrored
skill runs with whatever the Codex/OpenCode session allows. Mirroring all skills
is the chosen policy; tool-gating is the operator's agent config.

## Memory — only Claude self-writes it

Claude Code maintains an **agent-written** memory store at
`~/.claude/projects/<cwd-slug>/memory/*.md` (plus a `MEMORY.md` index), discovered
by the `memory-discovery-nudge` hook and promoted into rules by
`codifying-disciplines` / `codify-rule.mts`. **Codex and OpenCode have no
self-written memory**: each session starts fresh from the human-authored
`AGENTS.md`. So the **shared, cross-tool "memory" is the committed AGENTS.md**
(via the CLAUDE.md symlink). When a durable Claude memory is worth sharing across
tools, codify it into CLAUDE.md and every tool sees it through AGENTS.md.

## Kimi Code CLI — generated MCP + user config

Kimi Code CLI has no project-level instructions file; it reads user-owned config
from `~/.kimi-code/config.toml` and project-local MCP servers from
`.kimi-code/mcp.json`. The fleet treats `.mcp.json` as the single committed
authority and generates the Kimi adapter from it.

- **`.kimi-code/mcp.json`** is produced by `scripts/fleet/mcp-config.mts`
  (`pnpm run setup:mcp` regenerates it). It carries the same stdio commands and
  HTTP OAuth servers as `.codex/config.toml` and `opencode.json`, but in Kimi's
  native JSON shape.
- **`~/.kimi-code/config.toml`** is managed by
  `scripts/fleet/setup/setup-kimi-user-config.mts`
  (`pnpm run setup:kimi-user-config`). It extracts the fleet-canonical
  `permissions` block from `.claude/settings.json` and rewrites it as Kimi
  `[[permission.rules]]` entries, preserving any user-owned rules outside the
  fleet block.
- **`.kimi-code/local.toml`** is ignored by git so operators can keep local
  overrides without dirtying the tree.

Kimi ships in the release bundle as generated files only (no symlinks). The
bootstrap installer (`bootstrap/fleet.mjs --update`) and `pnpm install` prepare
step keep the project-local `.kimi-code/mcp.json` and user config current.

## Detection + paths — `@socketsecurity/lib/ai/agent-context`

Hooks receive **no agent id in their stdin payload**; the running agent is
identified by the **environment** it injects. Two helpers:

- **`detectAgent()`** reports which agent is invoking this process. It reads
  `AI_AGENT` (Claude Code sets `AI_AGENT=claude-code_<ver>_agent`) and falls back
  to `CLAUDECODE` / `CODEX_*` / `OPENCODE`. It returns `{ agent, raw }`, or
  `undefined` in a plain shell / CI. A `.claude/hooks/` script is Claude-invoked,
  so this helper is most useful for scripts/skills that branch on the active
  agent or on delegation.
- **`agentPaths(agent, { cwd })`** returns the config dir (plus the memory dir,
  claude-only) an agent uses on **this OS**. It builds on `getHome()` (HOME, then
  USERPROFILE) and `getXdgConfigHome()` so a Windows path differs from mac/linux
  correctly. Per agent: claude uses `~/.claude`; codex uses `$CODEX_HOME` or
  `~/.codex`; opencode uses XDG `~/.config/opencode` (Windows `%APPDATA%`,
  best-effort); gemini uses `~/.gemini`.

It complements `discoverAiAgents()` (which agents are INSTALLED): agent-context
answers which one is DRIVING and where it lives. Import from
`@socketsecurity/lib-stable/ai/agent-context` once a lib version carrying it is
published and the `-stable` pin is bumped. It is unpublished as of authoring, so
the fleet hooks wire to it after that publish.
