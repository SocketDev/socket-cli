# npm anti-bot rhythm

npmjs.com sits behind bot management. The fleet's npm browser tools work with
it, not around it: a human signs in once in plain Chrome, automation only reuses
that seeded session, and when a write triggers a human-verification challenge the
run PAUSES for a person to solve it. That rhythm lives in one place -
`scripts/fleet/publish-infra/npm/browser-session.mts`, the `runChallengeAware`
helper - so no tool re-derives it.

## Why login is plain Chrome, not automation

npm's bot management DROPS a login performed in a CDP / devtools-driven browser:
the sign-in and OTP succeed, then the site bounces straight back to the
signed-out landing page. The CDP wire itself is the tell, so no launch-flag
tuning fixes it. `browser-sign-in.mts` therefore launches real, CDP-free Chrome
on the shared profile for the one human sign-in. Every automation launch
(`openNpmBrowserSession`) only ever REUSES the session cookie that sign-in
seeded - it never types a credential.

## The "Chrome is being controlled by automated software" infobar stays

- The infobar stays VISIBLE. `--disable-infobars` would hide it, but the launch
  shape in `browser-session.mts` is a no-args-array invariant - the file header
  declares it and
  `scripts/fleet/check/playwright-launches-are-sanctioned.mts` enforces it - so
  adding a flag to suppress a cosmetic banner would break the one rule that
  keeps every tool launching the same way. The real mitigation is already
  there: `--enable-automation` is dropped via `ignoreDefaultArgs`, which is
  what clears `navigator.webdriver` - the signal npm's bot management actually
  reads. Extending the args invariant is a separate, deliberate change, not a
  side effect of tidying a banner.

## Reads are honored; sensitive writes get challenged

An existing session cookie is honored for reads and navigation: the tools read
`/-/whoami`, the staged-packages view, and a package's access page through the
signed-in page session. Sensitive WRITE operations - changing Trusted Publisher
settings, publishing - can trigger a human-verification challenge even on a
valid session.

## The challenge is PAUSED, never blind-retried

A challenge is a person's job. The run brings the Chrome window to the front,
prints an elapsed / remaining countdown, and waits for the operator to solve it.
It is NEVER retried on a backoff ladder: a retry into a live challenge earns a
rate limit, and that rate limit then masquerades as a broken session - the exact
false trail that turns a five-minute pause into an hour of debugging. Nothing is
written while a challenge is outstanding.

## The rhythm

1. A write triggers a challenge. The operator solves ONE challenge in the window.
2. The driver ticks npm's per-IP cooldown opt-in (the `didOptForCooldown`
   checkbox, `COOLDOWN_OPTIN_SELECTOR`).
3. With the opt-in ticked, subsequent trust / publish operations skip
   re-challenge for about five minutes.
4. Batch the rest of the work into that window - the first package in a batch
   pays the pause, the rest ride the cooldown.
5. When the window lapses, the next operation draws a fresh challenge. Solve it,
   repeat.

## Where it lives

`runChallengeAware` (in `browser-session.mts`) owns the whole loop: it runs a
caller's operation, and each time the operation reports a challenge it calls
`pauseForChallenge` (visible countdown, cooldown opt-in, budget enforcement) and
re-attempts - bounded by `CHALLENGE_BUDGET_MS`, never a blind retry. When the
budget is spent it throws a What / Where / Saw-vs-wanted / Fix block that says it
stopped rather than retried into a rate limit.

The operation owns what it does and how it classifies its own result into a
finished value, a challenge, or a transient race retry; the helper owns only the
pause-then-retry orchestration. Both consumers - the Trusted Publisher settings
driver (`trusted-publisher-page.mts`) and the staged-tarball read
(`staged-browser-read.mts`) - call `runChallengeAware`, so the anti-bot rhythm
exists once.
