# answer-passing-questions-reminder

**Lifecycle**: Stop

**Purpose**: catches the failure mode where the user asks a passing question while Claude is mid-task and the response deflects ("later" / "right now I'm doing X" / "let me finish first") instead of answering inline.

## What triggers it

The hook fires on `Stop` and only emits a reminder when both conditions hold:

1. The most recent user turn contains a question — `?` punctuation, or interrogative leading (`is`, `should`, `do we`, `would`, `can we`, `where`, `why`, `what`, `how`, `which`).
2. The most recent assistant turn either contains a deflection phrase or doesn't contain text that looks like an answer (no statement-shape sentence touching the question keywords).

## Exception

Questions containing an explicit pivot signal (`now do X` / `instead let's` / `switch to` / `stop and`) are **redirects, not passing questions**. The hook skips those — the right response is to pivot, not to answer inline.

## Disable

Set `SOCKET_ANSWER_PASSING_QUESTIONS_REMINDER_DISABLED=1` in the session env.

## Why this hook exists

The assistant's habit of treating passing questions as interruptions instead of opportunities silently degrades collaboration. Users learn not to ask questions mid-task, which means small misunderstandings compound into bigger redirects later. The reminder makes the pattern visible at Stop so the next response can address the unanswered question.
