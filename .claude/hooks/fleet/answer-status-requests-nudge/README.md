# answer-status-requests-nudge

**Lifecycle**: Stop

**Purpose**: catches the failure mode where the user explicitly asks for a status update on in-flight work and the assistant declines with a rate-limiting excuse like "too soon since last check" or "skipping".

## What triggers it

The hook fires on `Stop` when both conditions hold:

1. The most recent user turn matches a status-request shape (case-insensitive):
   - `check status`, `status?`, `status update`
   - `how's it going` / `how's the build` / `how is it`
   - `what's it doing`
   - `is it done`
   - `still running`
   - `what's happening`
   - `where are we`
   - `progress?`
2. The most recent assistant turn matches a decline shape:
   - `too soon since (last|the last|my last) check`
   - `skipping`

## Why this hook exists

Self-imposed rate limiting against the user's explicit ask is the wrong default. The user knows they asked; the answer is to check, not to lecture about cadence. The reminder fires at Stop so the next response actually performs the check.
