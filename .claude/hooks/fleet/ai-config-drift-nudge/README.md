# ai-config-drift-nudge

Stop hook. At turn-end, runs `git status --porcelain` and flags any modified or
untracked file under an AI-assistant config tree (`.claude/`, `.cursor/`,
`.gemini/`, `.vscode/`). Warns; never blocks.

## Threat

The 2026-06 Miasma-class self-replicating npm worm's postinstall **writes**
payloads into AI-assistant config files — a persistence + repo-poisoning angle.
Claude Code hooks can't intercept that OS-level write (it isn't a Claude tool
call), but it surfaces as git drift on the next turn. A `.cursor/` or `.gemini/`
tree appearing in a repo that never had one, or `.claude/` files changing with
no corresponding Claude edit, is the postinstall signature.

## Action

Lists the drifted config files with their git status and tells the agent: if you
did not author these edits this turn, treat them as untrusted and inspect for
poisoning directives (bypass a guard / exfiltrate secrets / store tokens
off-keychain — the `ai-config-poisoning-guard` fingerprint set) before trusting
or committing them.

Exit 0 always (Stop hooks fire after the turn — informational, not a gate).

## Pairing

Companion to `ai-config-poisoning-guard`, which blocks Claude's _own_
poison-shaped writes to these paths at edit time. This reminder catches the
out-of-band case — a dependency / upstream wrote them — that edit-time hooks can't
see. Distinct base names so they don't violate the fleet `-guard`/`-nudge`
no-overlap rule.

## Bypass

No bypass — the reminder never blocks. Investigate the out-of-band write.
