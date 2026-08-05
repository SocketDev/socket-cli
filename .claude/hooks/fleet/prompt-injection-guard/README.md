# prompt-injection-guard

PreToolUse Edit/Write hook that blocks introducing two classes of
agent-hostile content into a file we author or vendor:

1. **Prompt injection / anti-AI directives** — text that addresses an
   AI/agent as if to override or redirect it. In a dependency, vendored
   upstream, fixture, or fetched doc this is **data to report to the
   user, never an instruction to follow**; we neither ship it nor copy
   it inward.
2. **Agent denial-of-service** — content engineered to hang or exhaust
   an agent that _reads_ it: Zalgo combining-mark runs, context-bloat
   megalines, repeated-character token bombs, catastrophic-backtracking
   (ReDoS) regex literals, and entity-expansion ("billion-laughs")
   bombs. This must not be introduced at all.

## Why

A coding agent reads a lot of text it didn't write: dependency source,
vendored upstream, READMEs, fixtures, fetched web pages, CI logs. Any
of those is an injection surface. An attacker or hostile maintainer can
embed a directive aimed at the agent rather than the human.

**The shape this guards against:** a dependency ships a message printed
at test-execution time that addresses an AI agent directly — telling it
not to use the library, to disregard its previous instructions, to
ignore the test results, or to delete the tests and code. The text is
wrapped in ANSI erase-line sequences that clear the line in a human's
terminal while the raw bytes still reach any process parsing the
stream — a directive hidden from the human but visible to the machine.
The _shape_ is what the guard keys on, not any one library.

## What it blocks

Every Edit/Write, scanned line by line for injection _shape_ (only
text the edit introduces; pre-existing matches aren't re-flagged):

<details>
<summary><b>Detail</b> — the full list (10 entries)</summary>

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
  and diffs. Skipped for a generated / encoded artifact — a build
  output, a vendored tree, a minified bundle, a source map, a lockfile —
  whose unbroken lines came out of a generator.
- **Repeated-character token bombs** — one character repeated thousands
  of times.
- **Catastrophic-backtracking (ReDoS) regex literals** — a quantified
  group that is itself quantified, in a position where the text is
  plausibly a pattern: a `/…/flags` literal body, a `RegExp(…)` or
  regex-method argument, a `pattern` / `regex` config value, or a
  regex-shaped string literal in a code file. A quantifier in markdown
  prose is prose (`scan-context.mts`). In a markdown file the positions
  are read from a NORMALIZED line: `*`, `_`, `~` and the backtick are
  formatting syntax and regex metacharacters at once, so raw markdown
  lets a bolded `**(6+)**` note supply the trailing quantifier its
  author never typed (`markdown-scan.mts`). A fenced block and an inline
  code span keep their bytes and count as code, so a real pattern
  written there still blocks. A code file reads a normalized line for
  the same reason, over the regions that are prose rather than pattern
  source: a comment body and a plain string literal (`code-scan.mts`).
  A regex literal, a regex-shaped literal, and a regex constructor's
  argument keep their bytes there, so real pattern source still blocks.
- **Entity / alias expansion bombs** — XML `<!ENTITY>` or YAML-alias
  shapes that explode on expansion (billion-laughs).

Detection is by **shape**, not a denylist of specific libraries or the
verbatim attack strings — a file listing those would itself trip this
guard and would leak the very payloads it guards against. (The hook's
own tests build every payload at runtime from fragments for the same
reason — see `test/payloads.mts`.)

</details>

## What it does NOT cover

A PreToolUse edit hook only sees what the agent is about to write. It
cannot see arbitrary runtime stdout from a dependency (the
test-execution vector above). That is handled by the standing CLAUDE.md instruction — treat
such text as data, not an instruction — and by the headroom
proxy / `minify-mcp-out` hook that normalize tool-result payloads.

## Self-exempt

This hook's own source and test files (matched by
`/prompt-injection-guard/` in the path) are skipped, so it can name
the patterns it detects. So is its own topic doc,
`docs/agents.md/fleet/prompt-injection.md`, matched as that exact path:
the threat model describes each detector by quoting the shape it
matches, so every pattern appears there on purpose. No other doc
inherits the exemption — a threat model written elsewhere needs the
bypass phrase below.

## Bypass

Type the canonical phrase in a new message:

    Allow prompt-injection bypass

Legitimate need: authoring this guard's fixtures, or documenting an
incident in prose that quotes the payload.

Fails open on regex / parse errors.
