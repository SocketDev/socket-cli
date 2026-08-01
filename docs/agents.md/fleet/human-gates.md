# Human gates

A **human gate** is a step in an otherwise scripted flow that only the operator can clear: browser auth, a 2FA/OTP challenge, a hook authorization phrase, a staged-publish approve, or window state (quit this Chrome profile). Agents used to improvise these asks, so the operator had to re-parse a novel prompt every time and could not tell whether an agent-driven option existed. The fleet fixes the shape.

## The shape

Every gate renders identically, composed from `scripts/fleet/_shared/human-gate.mts`:

```
🖐  HUMAN GATE — npm auth [1/3]
  Need: the local npm token is missing or expired (`npm whoami` → 401).
  Mind: raw `npm login` dies without a TTY (legacy Username prompt EOFs) and bare `npm` fails in-repo (devEngines pins pnpm); the router carries both limitations so neither lane can hit them.
  A) You: run `node scripts/fleet/npm-web-auth.mts login` in your terminal — same flow, you drive.
  B) Me: say "log me in" and I run `node scripts/fleet/npm-web-auth.mts login` through its PTY — your browser opens for the OAuth + OTP, I wait.
  Then: re-run the pipeline — receipts resume at verify.
```

The rules, each load-bearing:

1. **Both lanes are always printed.** Lane A is what the human runs or types themselves; lane B is what they say to have the agent drive it, with the browser opening for them. When no agent lane can exist — authorization phrases count only when a human types them in a user turn — lane B states that honestly (`no agent lane — …`) instead of vanishing, so the operator never wonders whether an option was omitted.
2. **Same command, two runners.** Both lanes run the SAME non-interactive-capable command; only who drives it differs. A gate must never send the human down a path that fails in the other context ("oh, `!` won't work — do this instead"). The fleet routers make this possible: they pass through when a real TTY is present and run under a PTY when not.
3. **`Mind:` names the active restriction.** The guard or tool limitation that shaped the lanes (devEngines veto, no-TTY input, sanctioned-browser law, phrase provenance) is printed, so the operator never picks a lane a guard would block and never wonders why the obvious raw command isn't offered.
4. **`Then:` closes every block.** It names what resumes once the gate clears, which is also the cost of ignoring it.
5. **Multiple gates render as one numbered queue** (`[i/N]`), ordered by what must clear first, so the whole path to unblocked is visible at once — never one ask at a time across several messages.
6. **Compose from the catalog, never hand-write the prose.** `npmAuthGate`, `pushGrantGate`, `approveGate`, and `browserSessionGate` carry the canonical wording; a script that invents its own phrasing drifts and defeats the point. A mirror test (`test/repo/unit/human-gate.test.mts`) asserts the shape.

## npm vs pnpm: know the limitations, encode the choice

Gate lanes never name raw `npm`/`pnpm` commands — they name the fleet routers, which already encode when each tool works. The decision table the routers implement:

| Operation | Tool | Why |
| --- | --- | --- |
| `login` / `adduser` | pnpm (web OAuth) when available, else npm behind a PTY | raw `npm login` without a TTY falls back to the legacy `Username:` prompt and EOFs; pnpm's login opens the browser directly |
| `stage list` / stage ops | pnpm | the staging endpoints are pnpm-native; an UNAUTHENTICATED stage list parses as EMPTY, not as an error — always identity-check first |
| approve / promote | npm behind a PTY | the promotion flow is npm's; the PTY carries its browser 2FA from agent shells |
| `whoami` / identity reads | npm, from `npmScratchCwd()` | bare `npm` fails in-repo (devEngines pins pnpm), and a home-dir cwd makes lib spawn drop every home-rooted PATH entry |

Two traps the `Mind:` lines keep visible: **split identities** — pnpm's config token and npm's `.npmrc` token can be different accounts, and a non-maintainer login reads a real stage as "0 staged entries"; and **no-TTY contexts** — the `!` in-session input and agent shells have no TTY, so only PTY-wrapped or web-flow commands belong in gate lanes.

## Where it is wired

- The release pipeline's verify runner emits the `npm auth` gate when the staged-entry listing is unauthenticated (`release-pipeline/release-runners/verify.mts`).
- `scripts/fleet/npm-web-auth.mts` is the auth router both auth-gate lanes name; `resolveAuthTool` inside it owns the npm-vs-pnpm choice.
- Agents follow the same shape conversationally for gates that surface outside scripts (push-grant phrases, browser-profile state) — the operator's global CLAUDE.md carries the identical block for non-fleet repos.

## Relationship to bypass phrases

A push-grant gate names the phrase for the human to type — the [bypass-phrases](bypass-phrases.md) table does the same. That is not laundering: the scanner matches transcript role provenance, so a phrase printed by an agent grants nothing — only the human typing it in a user turn does. What stays forbidden is asking another agent or session to produce the phrase.
