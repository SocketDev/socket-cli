# setup-basics-tools

Operator-invoked installer for the **socket-basics workflow stack**:
TruffleHog, Trivy, OpenGrep, and uv. Slim leaf of the
`setup-security-tools` umbrella.

## When to use

```sh
node .claude/hooks/setup-basics-tools/install.mts
```

For the full setup (firewall + scanners + socket-basics + misc), use
`node .claude/hooks/setup-security-tools/install.mts`.

## What gets installed

| Tool       | Source                              | Purpose                                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------------------- |
| TruffleHog | `github:trufflesecurity/trufflehog` | Secrets scanner                                                     |
| Trivy      | `github:aquasecurity/trivy`         | Container / IaC / SBOM vuln scanner                                 |
| OpenGrep   | `github:opengrep/opengrep`          | SAST (semgrep fork)                                                 |
| uv         | `github:astral-sh/uv`               | Python package manager (used by socket-basics for Python bootstrap) |
