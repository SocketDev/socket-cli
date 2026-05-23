# setup-claude-scanners

Operator-invoked installer for **AgentShield** + **zizmor** — the two
claude-config / GitHub-Actions scanners. Slim leaf of the
`setup-security-tools` umbrella.

## When to use

- You want to install or refresh ONLY the scanner surface
  (AgentShield + zizmor) without re-running the firewall /
  socket-basics / misc installers.
- You're onboarding a fresh worktree where the only thing you need
  scanning right now is claude-config + workflow YAML.

```sh
node .claude/hooks/setup-claude-scanners/install.mts
```

For the full setup (firewall + scanners + socket-basics + misc), use
`node .claude/hooks/setup-security-tools/install.mts`.

## Relationship to setup-security-tools

The umbrella `setup-security-tools/install.mts` does everything this
leaf does PLUS sfw (firewall) + socket-basics tools (TruffleHog,
Trivy, OpenGrep, uv) + misc tools (cdxgen, synp, janus).

This leaf is a thin re-entry point that imports `setupAgentShield`

- `setupZizmor` from the umbrella's `lib/installers.mts` and runs
  ONLY those. No token resolution / keychain / shell-rc plumbing is
  involved — the two scanners are auth-free.

## What gets installed

| Tool        | Source                                  | Purpose                                                       |
| ----------- | --------------------------------------- | ------------------------------------------------------------- |
| AgentShield | `pkg:npm/ecc-agentshield@1.4.0` via dlx | Claude AI config security scanner (prompt injection, secrets) |
| zizmor      | `github:zizmorcore/zizmor` GH-release   | GitHub Actions security scanner                               |
