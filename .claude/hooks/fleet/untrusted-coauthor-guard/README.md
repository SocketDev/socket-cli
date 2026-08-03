# untrusted-coauthor-guard

PreToolUse(Bash) hook that blocks a `git commit` whose message adds a
`Co-authored-by:` trailer for an identity not on the cascaded contributors
allowlist.

## Why

A GitHub issue or fork PR from a brand-new, low-history account — high/recent
numeric user id, ~zero followers, few repos, a ready-made patch plus detailed
"apply this" instructions — is **untrusted input**, not a vetted contributor.
Auto-adding a `Co-authored-by:` trailer for that account:

- launders an unknown identity into the repo's commit history and GitHub's
  contributor graph,
- signals a level of trust the account has not earned, and
- is a known social-engineering / supply-chain vector (the patch or its
  framing may be steering you).

Credit a co-author only when you can vouch for them. This hook makes "can I
vouch for them?" an explicit gate instead of an automatic trailer.

## What it blocks

A `git commit` (`-m`/`--message`/`--amend` text) carrying
`Co-authored-by: Name <email>` where `email` is **not**:

- the canonical identity, or a configured alias, in
  `.config/{fleet,repo}/git-authors.json` (the same allowlist
  `commit-author-guard` uses); or
- when **no** allowlist is configured, a GitHub noreply
  (`…@users.noreply.github.com`) for an account that isn't otherwise known —
  the precise shape a fresh drive-by account uses.

A commit with no `Co-authored-by:` trailer, or one crediting only allowlisted
identities, passes untouched.

## Bypass

`Allow untrusted-coauthor bypass` (verbatim, recent user turn) — **after** you
have actually vetted the account. To make a teammate a permanent trusted
co-author, add them to `.config/{fleet,repo}/git-authors.json` instead, so they
pass without a bypass.

## Detection

Reuses `readIdentityPolicy` from `.git-hooks/_shared/git-identity.mts` (DRY with
`commit-author-guard`) and `extractCommitMessage` from
`_shared/commit-command.mts`. The trailer is matched on the commit message text
(commit content), so no shell-AST parse is needed. Fails open on any error.
