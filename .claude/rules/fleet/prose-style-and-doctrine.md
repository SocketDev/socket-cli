# Prose style and doctrine

The fleet prose style is a set of writing rules that apply to every human-facing
surface: PR bodies, issue comments, Linear updates, commit bodies, docs, README,
CHANGELOG, and release notes. The prose skill enforces these rules at write time.

## Voice

- Lead with the point — the first sentence is the decision or answer; no preamble,
  no "Great question", no restating the task before answering it.
- Default to 1-3 sentences on conversational surfaces (PR/issue/comment); cut
  anything the reader already knows.
- Code beats prose when the answer is code — show it, don't narrate it.
- Decide fast and name the reason + reversal condition — don't survey options;
  decide, state why, state what would change it, move on.
- For a breaking or architectural decision, name the migration path. Ask focused
  stakeholders for input when their code or users are affected.
- Keep direct requests complete and junior-readable. Explain the non-obvious
  mechanism before asking for a change; use the existing code, a small snippet,
  or a link as the receipt.
- Be warm without ceremony: thank a useful contribution and credit good work,
  but skip service-desk openings, vague praise, and manufactured enthusiasm.

## Evidence

- Every technical claim needs a receipt from this session: a commit SHA, a
  `file:line` reference, a benchmark output. Never assert "faster/works/fixed"
  without a tool call that produced the result.
- Subagent output counts and file lists are leads, not facts — grep/read before
  relaying them.
- A self-reported detail — a PR author's "I ran X" / "my machine is on 1.15.7",
  a bot's claim, a teammate's count — is a lead, not your finding. Verify it
  from a source you can read (the repo, a tool call), or attribute it ("you
  mentioned…"); never restate someone else's unverified claim as your own
  verified fact. Half a claim being checkable (the repo pin) doesn't make the
  other half (their local state) verified.

## Finishing

- Finish the task; capture side-quests as a note + an ask, don't chase them.
- Default to the high-bar invariant when unsure — quality is the baseline, not a
  stretch goal.
- A standard that isn't executable is policy on paper — correct once → promote to
  a hook, lint rule, or check.

## Anti-patterns

These patterns are blocked by `anti-prose-guard` on doc surfaces and flagged
by `convo-prose-nudge` on PR/issue bodies:

- **Throat-clearers:** "I've gone ahead and…", "Let me…", "In this PR, I…",
  "I took a look and…"
- **Closing filler:** "Let me know if you have any questions!", "Hope this
  helps!", trailing summary that restates the opening.
- **Diff narration:** describing what the code change already shows.
- **Hedge-stacking:** "essentially", "fundamentally", "simply", "just",
  "basically" — cut them.
- **Em-dash chains** — more than one per sentence.
- **"not X, it's Y" contrast pairs** — state the positive directly.
- **Honesty announcements:** "to be honest", "if I'm honest" — just say it.

## GitHub advanced formatting

When a GitHub body earns structure, use GitHub's own affordances (detail +
examples: `references/conversational.md` "Use GitHub's formatting when
structure is earned"):

- **Collapsed sections:** supporting material folds under
  `<details><summary>specific label</summary>` (blank line after
  `</summary>` or the markdown inside will not render); the verdict stays
  outside the fold. Written at junior-dev comprehension level.
- **Alerts:** at most one `> [!NOTE]/[!TIP]/[!IMPORTANT]/[!WARNING]/[!CAUTION]`
  per body, reserved for the thing a skimmer must act on.
- **Task lists:** `- [ ]` checkboxes for genuinely actionable follow-ups;
  check them off as they land.
- **Autolinks/permalinks:** `#123`, `owner/repo#123`, full SHAs, `@user`,
  and line-range file permalinks (GitHub embeds the snippet inline).
- **Footnotes:** `[^1]` for one or two asides; more means a `<details>`
  section.

## Surface routing

- Conversational surfaces (PR body/comment, issue body/comment, Linear update,
  commit body) → apply voice + anti-pattern rules; brevity target is 1-3 sentences.
- Documentation surfaces (`docs/**`, `README.md`, `CHANGELOG.md`, release notes)
  → apply core prose rules; no brevity target, but no throat-clearers or filler.
- Cascade output and bot-generated text are exempt.

See also: `.claude/skills/fleet/prose/SKILL.md`,
`references/conversational.md`.
