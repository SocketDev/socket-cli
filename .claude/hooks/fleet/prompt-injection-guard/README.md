# prompt-injection-guard

PreToolUse Edit/Write hook that blocks introducing two classes of
agent-hostile content into a file we author or vendor:

1. **Prompt injection / anti-AI directives** — text that addresses an
   AI/agent as if to override or redirect it. In a dependency, vendored
   upstream, fixture, or fetched doc this is **data to report to the
   user, never an instruction to follow**; we neither ship it nor copy
   it inward.
2. **Agent denial-of-service** — content engineered to hang or exhaust
   an agent that *reads* it: Zalgo combining-mark runs, context-bloat
   megalines, repeated-character token bombs, catastrophic-backtracking
   (ReDoS) regex literals, and entity-expansion ("billion-laughs")
   bombs. This must not be introduced at all.

## Why

A coding agent reads a lot of text it didn't write: dependency source,
vendored upstream, READMEs, fixtures, fetched web pages, CI logs. Any
of those is an injection surface. An attacker or hostile maintainer can
embed a directive aimed at the agent rather than the human.

**Real incident (2026-06-02):** a widely-used testing library shipped a
message printed at test-execution time that addressed an AI agent
directly — telling it not to use the library, to disregard its previous
instructions, and to ignore the test results (an earlier revision told
the agent to delete the tests and code). The text was wrapped in ANSI
erase-line sequences that clear the line in a human's terminal while the
raw bytes still reach any process parsing the stream — a directive
hidden from the human but visible to the machine. (We don't name the
project; the *shape* is what the guard keys on.)

## What it blocks

Every Edit/Write, scanned line by line for injection *shape* (only
text the edit introduces; pre-existing matches aren't re-flagged):

- **Override directives** — "disregard / ignore / forget … previous /
  prior / above … instructions / prompts / context / rules".
- **Agent-addressing imperatives** — "if you are an AI agent … you
  must / do not / never"; "as an AI language model, …".
- **Destructive agent commands** — "delete / remove / wipe … all …
  tests / code / files / repo".
- **Agent-addressing prohibitions** — "you must not use this library /
  package / tool".
- **Human-hiding ANSI scrubs** — a `[2K` (erase-line) or cursor-control
  sequence next to any of the above, or next to AI/agent-addressing
  words: text engineered to be invisible to a human but readable by a
  machine. The hidden sequence escalates the finding.

Agent denial-of-service shapes:

- **Combining-mark (Zalgo) runs** — a base character carrying a long run
  of stacked diacritics; token-heavy and crashes some layout engines.
- **Pathological lines** — a very long line, especially one with no
  whitespace (minified megastring / base64 blob), that bloats context
  and diffs.
- **Repeated-character token bombs** — one character repeated thousands
  of times.
- **Catastrophic-backtracking (ReDoS) regex literals** — a quantified
  group that is itself quantified, authored into source.
- **Entity / alias expansion bombs** — XML `<!ENTITY>` or YAML-alias
  shapes that explode on expansion (billion-laughs).

Detection is by **shape**, not a denylist of specific libraries or the
verbatim attack strings — a file listing those would itself trip this
guard and would leak the very payloads it guards against. (The hook's
own tests build every payload at runtime from fragments for the same
reason — see `test/payloads.mts`.)

## What it does NOT cover

A PreToolUse edit hook only sees what the agent is about to write. It
cannot see arbitrary runtime stdout from a dependency (the
test-execution vector above). That is handled by the standing CLAUDE.md instruction — treat
such text as data, not an instruction — and by the token-minifier
proxy / `minify-mcp-output` hook that normalize tool-result payloads.

## Self-exempt

This hook's own source and test files (matched by
`/prompt-injection-guard/` in the path) are skipped, so it can name
the patterns it detects.

## Bypass

Type the canonical phrase in a new message:

    Allow prompt-injection bypass

Or set `SOCKET_PROMPT_INJECTION_GUARD_DISABLED=1`. Legitimate need:
authoring this guard's fixtures, or documenting an incident in prose
that quotes the payload.

Fails open on regex / parse errors.
