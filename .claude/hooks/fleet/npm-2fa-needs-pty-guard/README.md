# npm-2fa-needs-pty-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2). Fleet-scoped convention.

**Trigger:** a bare `npm publish|login|deprecate|owner|access` invocation,
detected by AST-parsing the command (`commandsFor`), not a raw regex.

**Why:** these npm operations require 2FA. On a real terminal npm runs a browser
web-auth flow — it prints an `https://www.npmjs.com/auth/cli/<id>` URL, opens the
browser, and polls until the human approves. Under an agent that flow breaks two
ways:

- **No TTY.** The agent Bash channel is not a terminal, so npm errors `EOTP`
  instead of opening the browser and staying alive to poll.
- **Masked URL.** The agent harness redacts the auth URL in displayed tool
  output as `auth/cli/***`, so it cannot be relayed from what the terminal shows.

The fix is the PTY wrapper `scripts/fleet/npm-web-auth.mts`: it runs npm under a
`script` pseudo-terminal so npm performs its native open-and-poll flow, and reads
the auth URL off the RAW process stream to auto-open it, sidestepping the masking.

**Staged-release doctrine:** fleet releases of a scoped `@socketsecurity/*`
package go through the STAGED web-UI flow, never a local `npm publish`. When the
blocked op is a publish of such a package the message says so instead of pointing
at the wrapper. The wrapper is for the interactive-auth mechanic of
`login`/`deprecate`/`owner`/`access` and non-fleet or placeholder publishes.

**Does NOT fire when:**
- `--otp=<code>` is already supplied — no browser is needed, and
  `no-npm-otp-flag-guard` separately owns the OTP-leak concern.
- the command already invokes the wrapper, i.e. it mentions `npm-web-auth`.
- the context is CI — `CI` / `GITHUB_ACTIONS` / `CONTINUOUS_INTEGRATION` set.
- the acted-on repo is not fleet-managed — the wrapper is a fleet script.

**Fix the message gives:** `node scripts/fleet/npm-web-auth.mts <op> <args...>`
(or the staged web-UI flow for a scoped `@socketsecurity/*` publish).

**Bypass:** `Allow npm-2fa-pty bypass` typed verbatim in a recent user turn.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Bash call.
