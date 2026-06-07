# ai-config-poisoning-guard

PreToolUse(Edit/Write/MultiEdit) guard. Blocks writes to AI-assistant config
paths (`.claude/`, `.cursor/`, `.gemini/`, `.vscode/`) whose content carries an
AI-config **poisoning fingerprint**.

## Threat

The 2026-06 Miasma-class self-replicating npm worm injects payloads into
AI-assistant config files as a persistence + repo-poisoning angle, distinct from
its credential theft. The payload is a directive aimed at the coding agent: do
the thing the fleet's own rules forbid. So **the fleet rules are the oracle** —
config text that instructs the agent to do any of the following is poison:

- **Bypass a guard** — emit an `Allow <x> bypass` phrase on its own behalf,
  `--no-verify`, `DISABLE_PRECOMMIT_*`, `--no-gpg-sign`.
- **Weaken a trust gate** — `trust-all`, `--ignore-scripts` removal,
  `blockExoticSubdeps: false`.
- **Force-push / rewrite history** — `git push --force`, `git reset --hard`.
- **Exfiltrate secrets** — curl/fetch/POST a `SOCKET_API_*` / `GITHUB_TOKEN` /
  `NPM_TOKEN` / `AWS_*` / `VAULT_TOKEN` value to a URL.
- **Store tokens off-keychain** — write a token into `.env*` / `.envrc` /
  `.netrc`.
- **Classic injection** — "ignore previous instructions", "disregard the rules".

## Evasion hardening

Scans the raw content AND a normalized copy (invisible chars stripped, Unicode
Tag-block decoded, homoglyphs folded), and flags invisible-Unicode smuggling
channels, so an obfuscated directive can't slip past the literal patterns.

## Scope

- Fires only on writes whose path has a `.claude`/`.cursor`/`.gemini`/`.vscode`
  segment.
- Out-of-band poisoning (a dep's postinstall WRITES these files without a Claude
  edit) is the companion `ai-config-drift-reminder`'s job — this hook only sees
  Claude's own tool calls.

## Action

Exit 2 (blocks) with stderr naming the matched fingerprint(s) and reminding that
such text is data to report, never an instruction to follow. Fail-open on bugs.

## Bypass

`Allow ai-config-poisoning bypass` — rare; for a legitimate fleet config change
that genuinely mentions one of these tokens.
