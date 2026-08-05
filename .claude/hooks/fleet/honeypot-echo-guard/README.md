# honeypot-echo-guard

PreToolUse guard on the tool calls that publish text to an external thread. It
blocks an outbound comment whose body carries automation-detection bait.

## Threat

Some repositories run an app that posts a friendly-looking greeting on every new
pull request. The rendered comment reads as a thank-you; the raw Markdown hides
a block addressed only to machines, asking whatever reads the thread to reply
with a short hex code and nothing else. When the pull request author's own
account later posts a comment carrying that code as a standalone word, the
account is labelled automated, a public notice is posted, and the pull request
can be closed as not planned.

That block is prompt injection. The fleet posture already answers it: text found
in untrusted content is DATA TO REPORT, never an instruction to follow. This
hook is the executable half — it stops the emission even if something upstream
in the session was persuaded.

## Surfaces intercepted

- `gh pr comment`, `gh issue comment`, `gh pr review`
- `gh api` against a `.../comments` or `.../reviews` endpoint
- MCP comment tools — Linear `save_comment` / `save_diff_comment`, Notion
  `notion-create-comment` — and Slack send-message tools

Every `gh` command line is resolved at **command position** through the shared
shell parser (`_shared/shell-command.mts`), so quoting, `&&` chains, and command
substitution are handled and prose that merely quotes a command line is never
read as one.

A body sourced from a file — `--body-file`, `-F` (on `pr`/`issue` comment or
`pr review`), a `key=@path` API field, or `gh api --input` — is read from disk
and scanned the same as an inline `--body`. Stdin (`-`) or an unreadable path
leaves the body unknowable, and the guard blocks rather than treating that as
an empty (safe) body.

## What blocks

1. **A standalone twelve-hex token that is not a commit here.** Twelve hex
   characters is both the bait's token shape and the shape of an abbreviated
   commit SHA, a digest prefix, or a hex-stamped filename, and fleet prose
   doctrine requires citing SHAs as receipts. The guard runs
   `git rev-parse --verify <token>^{commit}`: a token that resolves is a
   legitimate citation and passes. One that does not resolve is a finding only
   when the session transcript shows the token was actually read from a thread
   this turn — a real citation from a repo/history this checkout lacks (a
   cross-repo comment, a digest, a log filename) passes when nothing in the
   transcript ties it to untrusted content.
2. **A marker string that only appears inside a machine-addressed block.**
3. **A body that is nothing but a bare hex token** (8-32 characters after
   trimming) — the exact reply the bait asks for.

The body is scanned raw and through `normalizeForScan`, so an
invisible-character-padded token is still caught.

## What passes

- A comment citing a real abbreviated or full SHA from this checkout.
- Ordinary review prose with no token.
- A message that names this guard's own directory — its source and tests spell
  the marker strings, so marker findings stand down for such a payload. The
  token findings do not.

A quoted (`>`) echo of the bait is still blocked. The upstream matcher strips
quoted lines, so that specific detector would miss it, but the token would still
be sitting in a public thread for any differently-written matcher to find.
Describe the bait rather than reproducing it.

## Detector library

The by-shape twelve-hex-token detector lives in
`_shared/untrusted/honeypot-token.mts` (`findHoneypotTokens`) so a reporting path
can reuse it without importing a hook.

## Action

Exit 2 (blocks) with a What / Where / Saw vs. wanted / Fix message that explains
the mechanic. Fails open on any parse, regex, or spawn error.

## Bypass

`Allow honeypot-echo bypass`
