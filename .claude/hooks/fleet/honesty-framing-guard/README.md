# honesty-framing-guard

Stop hook, blocking. The honesty-framing family of words is a banned-word
verdict on chat replies — announcing candor implies the rest of the reply
lacks it, so the sentence gets rewritten, never softened. The exact token
list lives in the shared `_shared/honesty-framing.mts` source that every
prose surface consumes (`reply-prose-nudge` keeps the advisory heuristics;
`anti-prose-guard` and `convo-prose-nudge` cover doc and PR/issue surfaces).

- **Trigger:** Stop — scans the last assistant turn's text (code fences
  stripped).
- **Verdict:** blocks once so the reply is rewritten; degrades to a
  non-blocking notice when `stop_hook_active` is set, so Stop guards never
  loop.
- **Bypass:** none. Rewrite the sentence — state the fact plainly and delete
  the framing.
