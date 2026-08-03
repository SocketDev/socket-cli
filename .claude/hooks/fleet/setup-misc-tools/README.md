# setup-misc-tools

Operator-invoked installer for one-off tools: **cdxgen**, **synp**,
and **janus**. Slim leaf of the `setup-security-tools` umbrella.

## When to use

```sh
node .claude/hooks/fleet/setup-misc-tools/install.mts
```

For the full setup (firewall + scanners + socket-basics + misc), use
`node .claude/hooks/fleet/setup-security-tools/install.mts`.

## What gets installed

| Tool   | Source                                     | Purpose                                                    |
| ------ | ------------------------------------------ | ---------------------------------------------------------- |
| cdxgen | `github:CycloneDX/cdxgen` (slim SEA)       | CycloneDX SBOM generator (used by `socket scan sbom`)      |
| synp   | `pkg:npm/synp@1.9.14` via dlx              | yarn.lock ↔ package-lock.json converter (cross-PM interop) |
| janus  | `github:divmain/janus` (darwin-arm64 only) | Tool that some Socket workflows opt into                   |
