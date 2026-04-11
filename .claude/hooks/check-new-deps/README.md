# check-new-deps Hook

A Claude Code pre-tool hook that checks new dependencies against [Socket.dev](https://socket.dev) before they're added to the project. It runs automatically every time Claude tries to edit or create a dependency manifest file.

## What it does

When Claude edits a file like `package.json`, `requirements.txt`, `Cargo.toml`, or any of 17+ supported ecosystems, this hook:

1. **Detects the file type** and extracts dependency names from the content
2. **Diffs against the old content** (for edits) so only *newly added* deps are checked
3. **Queries the Socket.dev API** to check for malware and critical security alerts
4. **Blocks the edit** (exit code 2) if malware or critical alerts are found
5. **Warns** (but allows) if a package has a low quality score
6. **Allows** (exit code 0) if everything is clean or the file isn't a manifest

## How it works

```
Claude wants to edit package.json
        │
        ▼
Hook receives the edit via stdin (JSON)
        │
        ▼
Extract new deps from new_string
Diff against old_string (if Edit)
        │
        ▼
Build Package URLs (PURLs) for each dep
        │
        ▼
Call sdk.checkMalware(components)
  - ≤5 deps: parallel firewall API (fast, full data)
  - >5 deps: batch PURL API (efficient)
        │
        ├── Malware/critical alert → EXIT 2 (blocked)
        ├── Low score → warn, EXIT 0 (allowed)
        └── Clean → EXIT 0 (allowed)
```

## Supported ecosystems

| File | Ecosystem | Example dep format |
|------|-----------|-------------------|
| `package.json` | npm | `"express": "^4.19"` |
| `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | npm | lockfile entries |
| `requirements.txt`, `pyproject.toml`, `setup.py` | PyPI | `flask>=3.0` |
| `Cargo.toml`, `Cargo.lock` | Cargo (Rust) | `serde = "1.0"` |
| `go.mod`, `go.sum` | Go | `github.com/gin-gonic/gin v1.9` |
| `Gemfile`, `Gemfile.lock` | RubyGems | `gem 'rails'` |
| `composer.json`, `composer.lock` | Composer (PHP) | `"vendor/package": "^3.0"` |
| `pom.xml`, `build.gradle` | Maven (Java) | `<artifactId>commons</artifactId>` |
| `pubspec.yaml`, `pubspec.lock` | Pub (Dart) | `flutter_bloc: ^8.1` |
| `.csproj` | NuGet (.NET) | `<PackageReference Include="..."/>` |
| `mix.exs` | Hex (Elixir) | `{:phoenix, "~> 1.7"}` |
| `Package.swift` | Swift PM | `.package(url: "...", from: "4.0")` |
| `*.tf` | Terraform | `source = "hashicorp/aws"` |
| `Brewfile` | Homebrew | `brew "git"` |
| `conanfile.*` | Conan (C/C++) | `boost/1.83.0` |
| `flake.nix` | Nix | `github:owner/repo` |
| `.github/workflows/*.yml` | GitHub Actions | `uses: owner/repo@ref` |

## Configuration

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

All dependencies use `catalog:` references from the workspace root (`pnpm-workspace.yaml`):

- `@socketsecurity/sdk` — Socket.dev SDK v4 with `checkMalware()` API
- `@socketsecurity/lib` — shared constants and path utilities
- `@socketregistry/packageurl-js` — Package URL (PURL) parsing and stringification

## Caching

API responses are cached in-memory for 5 minutes (max 500 entries) to avoid redundant network calls when Claude checks the same dependency multiple times in a session.

## Exit codes

| Code | Meaning | Claude behavior |
|------|---------|----------------|
| 0 | Allow | Edit/Write proceeds normally |
| 2 | Block | Edit/Write is rejected, Claude sees the error message |
