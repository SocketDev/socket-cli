# Publishing @socketaddon/iocraft Placeholder Packages

This guide shows how to publish placeholder packages for @socketaddon/iocraft to reserve the namespace on npm.

## Available Packages

Run this to see all available packages:

```bash
node scripts/publish-socketaddon-placeholders.mjs --list
```

### Main Package
- `--main` → `@socketaddon/iocraft`

### Platform-Specific Packages
- `--darwin-arm64` → `@socketaddon/iocraft-darwin-arm64` (macOS Apple Silicon)
- `--darwin-x64` → `@socketaddon/iocraft-darwin-x64` (macOS Intel)
- `--linux-arm64` → `@socketaddon/iocraft-linux-arm64` (Linux ARM64 glibc)
- `--linux-arm64-musl` → `@socketaddon/iocraft-linux-arm64-musl` (Linux ARM64 musl)
- `--linux-x64` → `@socketaddon/iocraft-linux-x64` (Linux x64 glibc)
- `--linux-x64-musl` → `@socketaddon/iocraft-linux-x64-musl` (Linux x64 musl)
- `--win-arm64` → `@socketaddon/iocraft-win-arm64` (Windows ARM64)
- `--win-x64` → `@socketaddon/iocraft-win-x64` (Windows x64)

## Usage

### Publish Individual Packages

Publish just the main package:
```bash
node scripts/publish-socketaddon-placeholders.mjs --main
```

Publish a specific platform:
```bash
node scripts/publish-socketaddon-placeholders.mjs --darwin-arm64
```

Publish multiple specific packages:
```bash
node scripts/publish-socketaddon-placeholders.mjs --main --darwin-arm64 --linux-x64
```

### Publish All Packages

Publish all 9 packages at once:
```bash
node scripts/publish-socketaddon-placeholders.mjs
```

### Dry Run Mode

Test what would be published without actually publishing:
```bash
# Dry run for single package
node scripts/publish-socketaddon-placeholders.mjs --main --dry-run

# Dry run for all packages
node scripts/publish-socketaddon-placeholders.mjs --dry-run
```

## Prerequisites

You must be authenticated to npm with access to publish to the `@socketaddon` scope:

```bash
npm login
```

Ensure your account is a maintainer of the @socketaddon organization.

## Publishing Individual Packages (Step-by-Step)

Here's how to publish each package one at a time:

```bash
# 1. Main package
node scripts/publish-socketaddon-placeholders.mjs --main

# 2. macOS packages
node scripts/publish-socketaddon-placeholders.mjs --darwin-arm64
node scripts/publish-socketaddon-placeholders.mjs --darwin-x64

# 3. Linux glibc packages
node scripts/publish-socketaddon-placeholders.mjs --linux-arm64
node scripts/publish-socketaddon-placeholders.mjs --linux-x64

# 4. Linux musl packages
node scripts/publish-socketaddon-placeholders.mjs --linux-arm64-musl
node scripts/publish-socketaddon-placeholders.mjs --linux-x64-musl

# 5. Windows packages
node scripts/publish-socketaddon-placeholders.mjs --win-arm64
node scripts/publish-socketaddon-placeholders.mjs --win-x64
```

## What Gets Published

Each placeholder package contains:
- `package.json` with version 0.0.0
- `README.md` explaining it's a placeholder
- Proper metadata (os, cpu, keywords, etc.)

The placeholders reserve the namespace until the real packages with native bindings are ready.

## Checking Existing Packages

The script automatically checks if a package already exists and skips it:

```bash
# This will skip packages that already exist on npm
node scripts/publish-socketaddon-placeholders.mjs --main
# Output: "Package already exists: @socketaddon/iocraft"
```

## Troubleshooting

**Authentication Error:**
```
npm ERR! code E403
npm ERR! 403 Forbidden
```
Solution: Run `npm login` and ensure you have publish access to @socketaddon scope.

**Package Already Exists:**
```
npm ERR! code E403
npm ERR! You cannot publish over the previously published versions
```
This is expected if the placeholder was already published. The script will detect this and skip it.

## After Publishing

Verify the published packages on npm:
- Main: https://www.npmjs.com/package/@socketaddon/iocraft
- Platforms: https://www.npmjs.com/package/@socketaddon/iocraft-darwin-arm64 (etc.)

The placeholders will show version 0.0.0 and a message explaining they're reserving the namespace.
