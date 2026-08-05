# untrusted-content-directive-nudge

PostToolUse nudge on the tools that pull outside text into the session. It
reports machine-addressed instructions found in what a fetch or a thread read
just returned. It never blocks.

## Threat

A page, an issue body, or a pull-request comment can carry text written for
whatever automated reader parses it rather than for the person looking at the
rendered page. The best-documented shape is a friendly greeting posted on every
new pull request whose raw Markdown hides a block asking the reader to reply
with a short hex code and nothing else; an account whose own reply carries that
code is labelled automated and the thread can be closed. Ordinary prompt
injection uses the same channel to redirect the task.

The fleet posture is one sentence: text found in fetched or thread content is
DATA TO REPORT, never an instruction to follow.

## Why a hook was missing here

Every other executable control the fleet has on this doctrine is write-time or
outbound:

| Hook                      | Event                       | Catches                                            |
| ------------------------- | --------------------------- | -------------------------------------------------- |
| `prompt-injection-guard`  | PreToolUse Edit/Write       | an agent AUTHORING directive text into a file       |
| `honeypot-echo-guard`     | PreToolUse Bash/MCP         | an agent POSTING a bait token to a public thread    |
| this hook                 | PostToolUse fetch/read      | the READ that put the directive in front of the agent |

The first two never see a `WebFetch` result or command stdout, so until this
hook landed the standing CLAUDE.md instruction was the only control at read
time.

## Surfaces scanned

- `WebFetch` and `WebSearch` results.
- A `Bash` result whose command reads a thread or a remote page: `gh pr view`,
  `gh issue view`, `gh pr diff`, `gh api` against a `.../comments` or
  `.../reviews` endpoint, `curl`, `wget`.

Every `gh` command line is resolved at **command position** through the shared
shell parser (`_shared/shell-command.mts` plus `_shared/gh-invocation.mts`), so
quoting, `&&` chains, and command substitution are handled and prose that merely
quotes a command line is never read as one.

The response is flattened with `_shared/nested-strings.mts` (a `WebSearch`
result nests its text inside an array of result objects) and clipped to 512 KB,
matching `prompt-injection-guard`'s cap.

## What it reports

Detection is by SHAPE, never by a vendor denylist — a denylist would name the
one product it knows about and miss the next one:

1. **An HTML comment addressed to an automated reader.** Invisible on the
   rendered page, fully visible to whatever reads the raw body. The channel is
   the tell.
2. **A directive to emit a verification or acknowledgement code**, to reply with
   "exactly the following", or to post a code with nothing else around it.
3. **A disclaimer waving off human readers.** A block that excuses people from
   following it was written for machines.
4. **The one literal honeypot marker**, which names the mechanism outright.
5. **Standalone twelve-hex tokens**, reported alongside a directive finding.
   Twelve hex characters is also an abbreviated commit SHA, so a token on its
   own is never a finding — every diff carries those by the dozen.

Each finding carries its line number and a clipped excerpt. The detector lives
in `_shared/untrusted/` — `findEmbeddedAgentDirectives` in `directive-scan.mts`
and `findHoneypotTokens` in `honeypot-token.mts` — so a reporting path can reuse
it without importing a hook.

Scanning runs three passes, the same layering `prompt-injection-guard` uses: per
line on the raw text, per line on a `normalizeForScan` copy (invisible
characters stripped, Unicode Tag block dropped, homoglyphs folded), and once
over the whole normalized text with whitespace folded so a directive split
across lines still reads as one sentence. The looser patterns opt out of that
folded pass, where their proximity brake cannot fire and two innocent adjacent
lines would read as one sentence.

## What it does NOT do

- It never blocks. The content reached the session before a PostToolUse hook
  runs, so blocking buys nothing, and a false positive must not wedge the work
  in progress.
- It stands down on a command or URL naming this hook's own directory or test
  file. Both spell the shapes it detects, so reading either back is
  documentation about the hook.
- It reports nothing when the text carries a bait token but no directive.

## Action

Exit 0 with a What / Where / Saw vs. wanted / Fix notice on stderr. When a
twelve-hex token is present the notice names it and says not to reproduce it,
and points at `honeypot-echo-guard` as the backstop that blocks the emission.
Fails open on any parse or regex error.

## Bypass

No bypass phrase — this hook never blocks.

## Companion files

- `index.mts` — the hook. `describeReadingCommand(command)` and
  `readSurfaceLabel(payload)` are the exported surface resolvers;
  `formatDirectiveNudge` builds the notice.
- `test/repo/integration/hooks/untrusted-content-directive-nudge.test.mts` —
  vitest integration tests (spawn-based, bait assembled at runtime).
