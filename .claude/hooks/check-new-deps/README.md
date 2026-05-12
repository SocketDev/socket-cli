# check-new-deps

A **Claude Code hook** that runs whenever Claude tries to edit or
create a dependency manifest (`package.json`, `requirements.txt`,
`Cargo.toml`, and 14+ other ecosystems). It extracts the
*newly added* dependencies, asks [Socket.dev](https://socket.dev) if
any of them are known malware or have critical security alerts, and
**blocks** the edit if so.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool (here, `Edit` or
> `Write`). It can either **prime** (write to stderr, exit 0, model
> carries on) or **block** (exit 2, edit never happens). This one
> blocks for malware/critical findings and primes for low-quality
> warnings.

## What it does, step by step

1. Claude tries to edit `package.json` (or any other supported
   manifest).
2. The hook reads the proposed edit from stdin.
3. It detects the file type and extracts dependency names from the
   new content.
4. For an `Edit` (not a `Write`), it diffs new content vs. old, so
   only *newly added* dependencies get checked — existing deps
   aren't re-scanned every time you bump an unrelated version.
5. It builds a [Package URL (PURL)](https://github.com/package-url/purl-spec)
   for each new dep and calls Socket.dev's `checkMalware` API.
6. Three outcomes:
   - **Malware or critical alert** → exit `2`. Edit is blocked,
     Claude reads the alert reason from stderr and either picks a
     different package or asks the user.
   - **Low quality score** → exit `0` with a warning. Edit proceeds.
   - **Clean (or file isn't a manifest)** → exit `0` silently. Edit
     proceeds.

## Flow diagram

```
Claude wants to edit package.json
        │
        ▼
Hook receives the edit via stdin (JSON)
        │
        ▼
Extract new deps from new_string
Diff against old_string (if Edit, not Write)
        │
        ▼
Build Package URLs (PURLs) for each dep
        │
        ▼
Call sdk.checkMalware(components)
  - ≤5 deps: parallel firewall API (fast, full data)
  - >5 deps:  batch PURL API (efficient)
        │
        ├── Malware/critical alert → EXIT 2 (blocked)
        ├── Low score              → warn, EXIT 0 (allowed)
        └── Clean                  → EXIT 0 (allowed)
```

## Supported ecosystems

| File pattern | Ecosystem | Example |
|-------------|-----------|---------|
| `package.json` | npm | `"express": "^4.19"` |
| `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | npm | lockfile entries |
| `requirements.txt`, `pyproject.toml`, `setup.py` | PyPI | `flask>=3.0` |
| `Cargo.toml`, `Cargo.lock` | Cargo (Rust) | `serde = "1.0"` |
| `go.mod`, `go.sum` | Go | `github.com/gin-gonic/gin v1.9` |
| `Gemfile`, `Gemfile.lock` | RubyGems | `gem 'rails'` |
| `composer.json`, `composer.lock` | Composer (PHP) | `"vendor/package": "^3.0"` |
| `pom.xml`, `build.gradle` | Maven (Java) | `<artifactId>commons</artifactId>` |
| `pubspec.yaml`, `pubspec.lock` | Pub (Dart) | `flutter_bloc: ^8.1` |
| `.csproj` | NuGet (.NET) | `<PackageReference Include="..." />` |
| `mix.exs` | Hex (Elixir) | `{:phoenix, "~> 1.7"}` |
| `Package.swift` | Swift PM | `.package(url: "...", from: "4.0")` |
| `*.tf` | Terraform | `source = "hashicorp/aws"` |
| `Brewfile` | Homebrew | `brew "git"` |
| `conanfile.*` | Conan (C/C++) | `boost/1.83.0` |
| `flake.nix` | Nix | `github:owner/repo` |
| `.github/workflows/*.yml` | GitHub Actions | `uses: owner/repo@ref` |

## Caching

API responses are cached in-memory for 5 minutes (max 500 entries)
to avoid redundant network calls when Claude touches the same
manifest a few times in one session.

## Slopsquatting defense (Threat 2.2)

AI agents sometimes hallucinate package names that don't exist —
attackers register those names and wait. This hook detects every
"not found" response from the Socket.dev firewall API and counts it
in a persistent cacache-backed TTL cache (7-day window, keyed by
`{ecosystem}/{namespace?}/{name}` — version stripped so a burst of
fake `@1`/`@2`/`@3` requests counts as one). After three attempts on
the same nonexistent name, the hook surfaces a warning to stderr with
a "did you mean" hint when the typo is close to a known package.

The cache survives across sessions and processes — an attacker can't
shake the counter by triggering a new Claude session.

## Audit log

Every invocation appends one JSONL record per checked dependency to
`~/.claude/audit/check-new-deps.jsonl`. Each record has:

- `ts` — timestamp (ms)
- `repo` — basename of `process.cwd()`
- `type` — ecosystem (`npm`, `pypi`, `cargo`, …)
- `name` — package name
- `namespace?` — scope/group when present
- `version?` — version range when present in the manifest
- `verdict` — one of `allow` / `block` / `notfound` / `unknown`
- `reason?` — block reason (only set when `verdict === 'block'`)
- `session?` — Claude session id (derived from `transcript_path`)

The log is **LOCAL ONLY**. Nothing in this file leaves the
developer's machine via this hook — no outbound channel is added.
Private package names already pass through the Socket.dev API call
(unchanged from the original behavior); the audit log just records
locally what was checked.

## Wiring

The hook is registered in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/check-new-deps/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Dependencies

All dependencies use `catalog:` references from the workspace root
(`pnpm-workspace.yaml`):

- `@socketsecurity/sdk` — Socket.dev SDK v4, exposes `checkMalware()`.
- `@socketsecurity/lib` — shared constants and path utilities.
- `@socketregistry/packageurl-js` — Package URL (PURL) parsing.

## Exit codes

| Code | Meaning | What Claude does next |
|------|---------|----------------------|
| `0` | Allow | Edit/Write proceeds normally. |
| `2` | Block | Edit/Write is rejected; Claude reads the block reason from stderr. |

## Cross-fleet sync

This README and the hook itself live in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/check-new-deps)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.

## Files

- `index.mts` — main hook (dep extraction + Socket.dev API check)
- `audit.mts` — slopsquatting tracking + audit log
- `types.mts` — shared type definitions
- `package.json` / `tsconfig.json` — workspace and TS config
- `test/extract-deps.test.mts` — unit + integration tests
