# secret-content-guard

PreToolUse(Write|Edit) hook. **Blocks** a Write / Edit whose content carries a
literal secret VALUE shape.

## Why

A secret written into a file (an `AKIA…` AWS key, a `ghp_…` GitHub token, a
`sktsec_…` Socket key, a JWT, a PEM private-key header) was previously caught
only at commit time. So it sat in the working tree, where it could be read
back, echoed, or cached, until the commit landed. This guard is the
**edit-time twin** of the commit-time secret scan
(`.git-hooks/_shared/helpers.mts`) and the Bash-time `token-guard`. All three
read the same `SECRET_VALUE_PATTERNS` catalog in `_shared/token-patterns.mts`,
so a new vendor shape is added once and every gate picks it up (code is law,
DRY).

## What it blocks

A Write `content` / Edit `new_string` containing any secret value shape in
`SECRET_VALUE_PATTERNS` (Socket, LLM, GitHub/GitLab, AWS, Slack, Google, Stripe,
npm, DigitalOcean, Hugging Face, Val Town, Linear, JWT, PEM private key).

The matched secret is **never logged**, only its vendor label, so the block
message can't leak the credential.

## Bypass

`Allow secret-content bypass` in a recent user turn. Rare: authoring this
guard's own test fixtures, or a documented redacted example. The fix is almost
always to remove the secret. Tokens live in env vars (CI) or the OS keychain
(dev), never hardcoded.
